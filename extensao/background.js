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
  if (atual.some((x) => x.url === item.url)) return;
  const lista = [...atual, item].slice(-MAX_POR_ABA);
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
