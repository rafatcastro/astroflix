// Fica de olho nos vídeos que cada aba pede (o .m3u8 que o player carrega, que
// nunca aparece no HTML) e guarda, por aba, o endereço e os cabeçalhos com que o
// navegador o pediu: o Astroflix baixa com eles, como se fosse este navegador,
// já logado no site.

const MIDIA = /\.(m3u8|mpd|mp4|m4v|webm)(\?|$)/i;
// Pedaços de um vídeo (segmentos do HLS, faixas do DASH): não são o vídeo.
const PEDACO = /\.(ts|m4s|aac|vtt)(\?|$)|[/_-](seg|segment|chunk|frag)[-_]?\d+/i;
// Só estes cabeçalhos interessam para baixar de novo; o resto é do navegador.
const UTEIS = new Set(['authorization', 'cookie', 'referer', 'origin', 'user-agent']);
const MAX_POR_ABA = 40;

const chave = (tabId) => `aba:${tabId}`;

async function guardar(tabId, item) {
  const k = chave(tabId);
  const atual = (await chrome.storage.session.get(k))[k] ?? [];
  // Pedido de novo (voltou a uma aula já vista): vai para o fim com a hora nova,
  // que é o que o "Importar a página toda" usa para saber qual vídeo a aula abriu.
  const lista = [...atual.filter((x) => x.url !== item.url), item].slice(-MAX_POR_ABA);
  await chrome.storage.session.set({ [k]: lista });
  const n = new Set(lista.filter((x) => x.pagina === item.pagina).map((x) => x.url)).size;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
}

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    if (d.tabId < 0 || !/^https?:/.test(d.url)) return;
    if (!MIDIA.test(d.url) || PEDACO.test(d.url)) return;
    // O próprio Astroflix tocando uma aula não é vídeo novo.
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(d.url)) return;
    const cabecalhos = (d.requestHeaders ?? [])
      .filter((h) => UTEIS.has(h.name.toLowerCase()) && h.value)
      .map((h) => ({ nome: h.name, valor: h.value }));
    chrome.tabs.get(d.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      void guardar(d.tabId, { url: d.url, pagina: tab.url ?? null, cabecalhos, quando: Date.now() });
    });
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders'],
);

// Aba fechada: esquece. Página nova (inclusive troca de aula num site em
// JavaScript): o contador passa a contar só os vídeos dela.
chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(chave(tabId)));
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const k = chave(tabId);
  const lista = (await chrome.storage.session.get(k))[k] ?? [];
  const n = new Set(lista.filter((x) => x.pagina === info.url).map((x) => x.url)).size;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
});

// ---------- Importar a página toda ----------

// A página lista as aulas (no Ferretto, cada uma num <p class="text-sm
// font-family-body text-body font-semibold">). Para cada uma: clica, espera o
// player pedir o vídeo novo e manda para a playlist com o texto como título. Roda
// aqui, e não no popup, porque o popup fecha quando perde o foco; o progresso
// fica em storage.session e o popup o mostra ao reabrir.

const LOTE = 'lote';
// Quanto esperar o vídeo de uma aula: a que não tem vídeo custa esse tempo inteiro.
const ESPERA_MS = 20_000;
let parar = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const estado = async (patch) => {
  const atual = (await chrome.storage.session.get(LOTE))[LOTE] ?? {};
  await chrome.storage.session.set({ [LOTE]: { ...atual, ...patch } });
};

async function apiDoApp(caminho, corpo) {
  const { porta, chave: c } = await chrome.storage.local.get(['porta', 'chave']);
  const res = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: 'POST',
    headers: { 'X-Astroflix-Chave': c, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error ?? `HTTP ${res.status}`);
  return r;
}

// O vídeo que apareceu depois de `desde` (a lista do HLS/DASH antes de um .mp4).
async function videoNovo(tabId, desde, usados) {
  const k = chave(tabId);
  const fim = Date.now() + ESPERA_MS;
  while (Date.now() < fim && !parar) {
    const lista = ((await chrome.storage.session.get(k))[k] ?? []).filter((x) => x.quando >= desde && !usados.has(x.url));
    if (lista.length) {
      // Um instante para a lista principal chegar antes das de cada qualidade.
      await dormir(1200);
      const depois = ((await chrome.storage.session.get(k))[k] ?? []).filter((x) => x.quando >= desde && !usados.has(x.url));
      return depois.find((x) => /\.(m3u8|mpd)(\?|$)/i.test(x.url)) ?? depois[0];
    }
    await dormir(400);
  }
  return null;
}

async function importarPagina({ tabId, seletor, playlist, modulo }) {
  parar = false;
  const [{ result: titulos }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [seletor],
    func: (sel) => [...document.querySelectorAll(sel)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  });
  await estado({ ativo: true, total: titulos.length, feitos: 0, falhas: [], atual: null, playlist, terminou: null });
  const usados = new Set();
  // O vídeo que já está tocando quando começa: é o da aula aberta, que pode ser a primeira.
  const k = chave(tabId);
  const jaTocando = ((await chrome.storage.session.get(k))[k] ?? []).slice(-1)[0] ?? null;
  const falhas = [];
  for (let i = 0; i < titulos.length && !parar; i++) {
    const titulo = titulos[i] || `Aula ${i + 1}`;
    await estado({ atual: `${i + 1}. ${titulo}` });
    const desde = Date.now();
    // Clica no que é clicável em volta do parágrafo (o item da lista), ou nele.
    await chrome.scripting
      .executeScript({
        target: { tabId },
        args: [seletor, i],
        func: (sel, n) => {
          const el = document.querySelectorAll(sel)[n];
          if (!el) return false;
          el.scrollIntoView({ block: 'center' });
          const alvo = el.closest('a, button, [role=button], [onclick], li') ?? el;
          alvo.click();
          return true;
        },
      })
      .catch(() => null);
    let v = await videoNovo(tabId, desde, usados);
    // A primeira aula já estava aberta e não pediu o vídeo de novo ao ser clicada.
    // Só a primeira: em outra posição, seria o vídeo de outra aula com este título.
    if (!v && i === 0 && jaTocando && !usados.has(jaTocando.url)) v = jaTocando;
    if (!v) {
      falhas.push(`${titulo}: nenhum vídeo novo em ${ESPERA_MS / 1000} s`);
      await estado({ falhas });
      continue;
    }
    usados.add(v.url);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    try {
      await apiDoApp(`/api/extensao/playlists/${playlist}/itens`, {
        url: v.url,
        titulo,
        pagina: tab?.url ?? v.pagina,
        cabecalhos: v.cabecalhos ?? [],
        modulo,
      });
      const atual = (await chrome.storage.session.get(LOTE))[LOTE];
      await estado({ feitos: (atual?.feitos ?? 0) + 1 });
    } catch (e) {
      falhas.push(`${titulo}: ${e.message}`);
      await estado({ falhas });
    }
  }
  await estado({ ativo: false, atual: null, terminou: parar ? 'parado' : 'ok' });
}

// ---------- Seguir o botão "Próxima" ----------

// Plataformas como a do Ferretto não abrem outra aula pelo clique na lista (o
// laço acima fica parado depois da primeira), mas têm o botão "Próxima". Aqui:
// manda a aula aberta (título da página + o vídeo que o player pediu), clica em
// Próxima, espera o vídeo novo e repete, até não haver Próxima ou a aula não trocar.

const SELETORES_DE_TITULO = ['span.font-family-headlines', 'h1', 'h2'];
const MAX_AULAS = 500;

async function tituloDaAba(tabId) {
  const [r] = await chrome.scripting
    .executeScript({
      target: { tabId },
      args: [SELETORES_DE_TITULO],
      func: (seletores) => {
        for (const s of seletores) {
          const t = [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).find((x) => x && x.length < 150);
          if (t) return t;
        }
        return document.title;
      },
    })
    .catch(() => [null]);
  return r?.result ?? '';
}

// Clica no botão (ou link) visível e habilitado cujo texto começa com `texto`
// ("Próxima", "Próxima aula"), sem ligar para acento e maiúscula.
// `indice`: qual deles, na ordem da página (0 = o primeiro). Devolve quantos há
// (0 = nenhum, não clicou) e se clicou.
async function clicarNoBotao(tabId, texto, indice = 0) {
  const [r] = await chrome.scripting
    .executeScript({
      target: { tabId },
      args: [texto, indice],
      func: (txt, ind) => {
        const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const alvo = norm(txt);
        const visivel = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        };
        const todos = [...document.querySelectorAll('button, a, [role=button]')].filter(
          (e) => visivel(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && norm(e.innerText || e.getAttribute('aria-label') || '').startsWith(alvo),
        );
        const b = todos[ind];
        if (!b) return { clicou: false, total: todos.length };
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { clicou: true, total: todos.length };
      },
    })
    .catch(() => [null]);
  return r?.result ?? { clicou: false, total: 0 };
}

// Aulas com outro "Próxima" dentro: no Gabarito de questões do Ferretto, o
// primeiro passa para a próxima questão e só o segundo vai para a próxima aula.
const REGRAS_DO_BOTAO = [{ titulo: /gabarito de quest/i, indice: 1 }];
const indiceDoBotao = (titulo) =>
  REGRAS_DO_BOTAO.find((r) => r.titulo.test(titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))?.indice ?? 0;

// Aula sem vídeo que dê para baixar (texto, exercício, player protegido): é
// pulada, fica na lista "Puladas" e a extensão segue para a próxima. Para só sem
// "Próxima", se a aula não trocar depois do clique ou depois de muitas puladas
// seguidas (a página provavelmente parou de responder).
const MAX_PULADAS_SEGUIDAS = 15;

async function importarSeguindo({ tabId, playlist, modulo, textoBotao }) {
  parar = false;
  await estado({ ativo: true, total: null, feitos: 0, falhas: [], atual: null, playlist, terminou: null });
  const k = chave(tabId);
  const usados = new Set();
  const falhas = [];
  let desde = 0;
  let ultimoTitulo = null;
  let puladasSeguidas = 0;
  let fim = 'ok';
  // O botão clicado na última volta: se a aula não trocar, tenta o seguinte da
  // página (um "Próxima" de dentro da aula, como o das questões, vem antes).
  let indiceUsado = 0;
  let botoes = 0;
  let n = 0;
  while (n < MAX_AULAS && !parar) {
    let v;
    if (n === 0) {
      // A aula aberta: o último vídeo que ela pediu; sem nenhum, espera um pouco.
      const lista = (await chrome.storage.session.get(k))[k] ?? [];
      v = lista.filter((x) => /\.(m3u8|mpd)(\?|$)/i.test(x.url)).slice(-1)[0] ?? lista.slice(-1)[0];
      v ??= await videoNovo(tabId, Date.now(), usados);
    } else v = await videoNovo(tabId, desde, usados);
    if (parar) break;

    // O título troca junto com o vídeo, às vezes um instante depois.
    await dormir(800);
    let titulo = await tituloDaAba(tabId);
    if (n > 0 && titulo === ultimoTitulo) {
      await dormir(2000);
      titulo = await tituloDaAba(tabId);
    }
    // Clicou e nada mudou (nem vídeo, nem título): era um "Próxima" de dentro da
    // aula. Tenta o botão seguinte; sem mais nenhum, a página travou ou acabou.
    if (!v && n > 0 && titulo === ultimoTitulo) {
      if (indiceUsado + 1 < botoes) {
        indiceUsado++;
        desde = Date.now();
        const r = await clicarNoBotao(tabId, textoBotao, indiceUsado);
        botoes = r.total;
        if (r.clicou) continue;
      }
      fim = `a aula "${titulo}" não trocou depois de "${textoBotao}"`;
      break;
    }
    titulo ||= `Aula ${n + 1}`;
    await estado({ atual: `${n + 1}. ${titulo}` });

    if (!v) {
      falhas.push(`${titulo} (sem vídeo)`);
      puladasSeguidas++;
      await estado({ falhas });
      if (puladasSeguidas >= MAX_PULADAS_SEGUIDAS) {
        fim = `${MAX_PULADAS_SEGUIDAS} aulas seguidas sem vídeo`;
        break;
      }
    } else {
      puladasSeguidas = 0;
      usados.add(v.url);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      try {
        await apiDoApp(`/api/extensao/playlists/${playlist}/itens`, {
          url: v.url,
          titulo,
          pagina: tab?.url ?? v.pagina,
          cabecalhos: v.cabecalhos ?? [],
          modulo,
        });
        const atual = (await chrome.storage.session.get(LOTE))[LOTE];
        await estado({ feitos: (atual?.feitos ?? 0) + 1 });
      } catch (e) {
        falhas.push(`${titulo} (${e.message})`);
        await estado({ falhas });
      }
    }
    n++;
    ultimoTitulo = titulo;
    desde = Date.now();
    indiceUsado = indiceDoBotao(titulo);
    let r = await clicarNoBotao(tabId, textoBotao, indiceUsado);
    // A regra pedia o segundo, mas só há um: é ele.
    if (!r.clicou && indiceUsado > 0 && r.total > 0) {
      indiceUsado = 0;
      r = await clicarNoBotao(tabId, textoBotao, 0);
    }
    botoes = r.total;
    if (!r.clicou) break; // sem "Próxima": era a última aula
  }
  await estado({ ativo: false, atual: null, terminou: parar ? 'parado' : fim });
}

chrome.runtime.onMessage.addListener((m, _remetente, responder) => {
  if (m?.tipo === 'importar-seguindo') {
    void importarSeguindo(m).catch((e) => estado({ ativo: false, terminou: `erro: ${e.message}` }));
    responder({ ok: true });
  } else if (m?.tipo === 'importar-pagina') {
    void importarPagina(m).catch((e) => estado({ ativo: false, terminou: `erro: ${e.message}` }));
    responder({ ok: true });
  } else if (m?.tipo === 'parar-lote') {
    parar = true;
    responder({ ok: true });
  }
});
