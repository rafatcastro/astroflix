// O popup: pareia com o Astroflix (a chave das Configurações), lista as playlists
// e manda a aula aberta para a escolhida. O app escuta em 127.0.0.1, na 7777 ou
// na próxima livre, então a porta é procurada e lembrada.

const PORTAS = Array.from({ length: 21 }, (_, i) => 7777 + i);
const $ = (id) => document.getElementById(id);
let cfg = { porta: null, chave: null, ultimaPlaylist: null };
let aba = null;

function msg(texto, tipo = '') {
  $('msg').textContent = texto;
  $('msg').className = `aviso ${tipo}`;
}

async function api(caminho, init = {}) {
  const res = await fetch(`http://127.0.0.1:${cfg.porta}${caminho}`, {
    ...init,
    headers: { 'X-Astroflix-Chave': cfg.chave, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(corpo.error ?? `HTTP ${res.status}`), { status: res.status });
  return corpo;
}

async function acharApp(chave) {
  const ordem = cfg.porta ? [cfg.porta, ...PORTAS.filter((p) => p !== cfg.porta)] : PORTAS;
  for (const porta of ordem) {
    try {
      const res = await fetch(`http://127.0.0.1:${porta}/api/extensao/ping`, {
        headers: { 'X-Astroflix-Chave': chave },
        signal: AbortSignal.timeout(800),
      });
      if (res.status === 401 || res.status === 403) {
        const c = await res.json().catch(() => ({}));
        if (c.error === 'chave-errada') return { erro: 'chave-errada' };
        if (c.error === 'precisa-entrar') return { erro: 'precisa-entrar' };
        continue;
      }
      if (res.ok) return { porta };
    } catch {
      /* porta fechada: a próxima */
    }
  }
  return { erro: 'sem-app' };
}

const ERROS = {
  'sem-app': 'O Astroflix não respondeu. Abra o app e tente de novo.',
  'chave-errada': 'Chave errada. Copie de novo em Configurações → Extensão do navegador.',
  'precisa-entrar': 'Entre na sua conta no Astroflix primeiro.',
};

async function iniciar() {
  cfg = { ...cfg, ...(await chrome.storage.local.get(['porta', 'chave', 'ultimaPlaylist'])) };
  [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!cfg.chave) return mostrarPareamento();
  const r = await acharApp(cfg.chave);
  if (r.erro) {
    if (r.erro === 'chave-errada') return mostrarPareamento(ERROS[r.erro]);
    msg(ERROS[r.erro], 'erro');
    $('trocar').classList.remove('escondido');
    return;
  }
  cfg.porta = r.porta;
  await chrome.storage.local.set({ porta: r.porta });
  await mostrarPrincipal();
}

function mostrarPareamento(aviso) {
  $('parear').classList.remove('escondido');
  $('principal').classList.add('escondido');
  $('trocar').classList.add('escondido');
  if (aviso) msg(aviso, 'erro');
  $('chave').focus();
}

$('conectar').addEventListener('click', async () => {
  const chave = $('chave').value.trim();
  if (!chave) return;
  msg('Procurando o Astroflix…');
  const r = await acharApp(chave);
  if (r.erro) return msg(ERROS[r.erro], 'erro');
  cfg = { ...cfg, chave, porta: r.porta };
  await chrome.storage.local.set({ chave, porta: r.porta });
  $('parear').classList.add('escondido');
  msg('');
  await mostrarPrincipal();
});

$('trocar').addEventListener('click', (e) => {
  e.preventDefault();
  mostrarPareamento();
});

// Cada playlist e, embaixo dela, as sub-playlists (módulos). O valor da opção é
// "id|subpasta" (subpasta vazia = a raiz da playlist).
let playlists = [];
async function carregarPlaylists(escolher) {
  playlists = await api('/api/extensao/playlists');
  const sel = $('playlist');
  sel.innerHTML = '';
  for (const p of playlists) {
    const o = document.createElement('option');
    o.value = `${p.id}|`;
    o.textContent = `${p.titulo} (${p.itens})`;
    sel.appendChild(o);
    for (const m of p.modulos ?? []) {
      const s = document.createElement('option');
      s.value = `${p.id}|${m.pasta}`;
      s.textContent = `\u00a0\u00a0\u00a0↳ ${m.nome} (${m.itens})`;
      sel.appendChild(s);
    }
  }
  const alvo = escolher ?? cfg.ultimaPlaylist;
  if (alvo && [...sel.options].some((o) => o.value === alvo)) sel.value = alvo;
  if (!playlists.length) msg('Nenhuma playlist ainda: crie uma com o +.');
  return playlists;
}

const escolhida = () => {
  const [id, modulo] = ($('playlist').value || '|').split('|');
  return { id, modulo: modulo || null };
};

// O nome da aula. Primeiro os lugares conhecidos de plataformas de curso (no
// Ferretto, o título da aula fica num <span class="font-family-headlines">);
// depois o título grande da página (h1/h2); por último o da aba, que vem com o
// nome do site junto.
const SELETORES_DE_TITULO = ['span.font-family-headlines', 'h1', 'h2'];

async function tituloDaAula() {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      args: [SELETORES_DE_TITULO],
      func: (seletores) => {
        for (const s of seletores) {
          const t = [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).find((x) => x && x.length < 150);
          if (t) return t;
        }
        return document.title;
      },
    });
    if (r?.result) return r.result;
  } catch {
    /* página do navegador, sem permissão */
  }
  return aba?.title ?? '';
}

async function mostrarPrincipal() {
  $('principal').classList.remove('escondido');
  $('trocar').classList.remove('escondido');
  try {
    await carregarPlaylists();
  } catch (e) {
    return msg(ERROS[e.message] ?? `Erro: ${e.message}`, 'erro');
  }
  $('titulo').value = await tituloDaAula();

  const k = `aba:${aba.id}`;
  const todos = (await chrome.storage.session.get(k))[k] ?? [];
  // Os desta página primeiro (num site em JavaScript a aba guarda os das aulas
  // anteriores também); dentro, a lista do HLS/DASH antes de um .mp4 solto.
  const peso = (v) => (v.pagina === aba.url ? 0 : 2) + (/\.(m3u8|mpd)(\?|$)/i.test(v.url) ? 0 : 1);
  const videos = [...todos].sort((a, b) => peso(a) - peso(b) || b.quando - a.quando);
  const caixa = $('videos');
  caixa.innerHTML = '';
  const opcao = (valor, texto, marcado) => {
    const l = document.createElement('label');
    l.className = 'video';
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'video';
    r.value = valor;
    r.checked = marcado;
    l.appendChild(r);
    l.appendChild(document.createTextNode(texto));
    caixa.appendChild(l);
  };
  videos.forEach((v, i) => opcao(String(i), `${v.pagina === aba.url ? '' : '(outra página) '}${v.url}`, i === 0));
  opcao('pagina', videos.length ? 'Nenhum destes: mandar só a página' : 'Nenhum vídeo visto ainda: dê play e abra de novo, ou mande a página', !videos.length);
  $('adicionar').onclick = () => adicionar(videos);
}

async function adicionar(videos) {
  const valor = $('playlist').value;
  const { id: playlist, modulo } = escolhida();
  if (!playlist) return msg('Escolha ou crie uma playlist.', 'erro');
  const marcado = document.querySelector('input[name=video]:checked')?.value ?? 'pagina';
  const v = marcado === 'pagina' ? null : videos[Number(marcado)];
  $('adicionar').disabled = true;
  try {
    const r = await api(`/api/extensao/playlists/${playlist}/itens`, {
      method: 'POST',
      body: JSON.stringify({
        url: v?.url ?? aba.url,
        titulo: $('titulo').value.trim() || aba.title,
        pagina: aba.url,
        cabecalhos: v?.cabecalhos ?? [],
        modulo,
      }),
    });
    cfg.ultimaPlaylist = valor;
    await chrome.storage.local.set({ ultimaPlaylist: valor });
    msg(r.repetido ? `Essa aula já estava na playlist (nº ${r.posicao}); o endereço foi atualizado.` : `Adicionada como aula ${r.posicao}. O Astroflix está baixando.`, 'ok');
    await carregarPlaylists(valor);
  } catch (e) {
    msg(ERROS[e.message] ?? `Não deu: ${e.message}`, 'erro');
  } finally {
    $('adicionar').disabled = false;
  }
}

$('nova').addEventListener('click', () => {
  $('novaLinha').classList.toggle('escondido');
  $('novaNome').focus();
});
async function criar(dentro) {
  const titulo = $('novaNome').value.trim();
  if (!titulo) return $('novaNome').focus();
  const { id } = escolhida();
  if (dentro && !id) return msg('Escolha antes a playlist onde criar.', 'erro');
  try {
    let valor;
    if (dentro) {
      const r = await api(`/api/extensao/playlists/${id}/modulos`, { method: 'POST', body: JSON.stringify({ titulo }) });
      valor = `${id}|${r.pasta}`;
    } else {
      const r = await api('/api/extensao/playlists', { method: 'POST', body: JSON.stringify({ titulo }) });
      valor = `${r.id}|`;
    }
    $('novaLinha').classList.add('escondido');
    $('novaNome').value = '';
    await carregarPlaylists(valor);
    msg(dentro ? `"${titulo}" criada dentro da playlist.` : `Playlist "${titulo}" criada.`, 'ok');
  } catch (e) {
    msg(`Não deu: ${e.message}`, 'erro');
  }
}
$('criar').addEventListener('click', () => void criar(false));
$('criarSub').addEventListener('click', () => void criar(true));

void iniciar();
