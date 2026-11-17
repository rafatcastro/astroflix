// Os links de uma página que podem levar a um vídeo. Uma página de curso costuma
// ter a lista de aulas como links para outras páginas do mesmo site, cada uma
// com o player; o yt-dlp sozinho só olharia a página colada. Aqui sai a lista de
// candidatos, e quem decide se há vídeo em cada um é o yt-dlp.

// Arquivos que nunca são uma aula: estilo, script, imagem, fonte, documento.
const NAO_VIDEO = /\.(css|js|mjs|json|xml|png|jpe?g|gif|svg|webp|ico|avif|woff2?|ttf|otf|eot|pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|rss)(\?|$)/i;
const MIDIA = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd)(\?|$)/i;
// Players e sites de vídeo conhecidos: vale abrir mesmo sendo de outro domínio.
const HOSTS_DE_VIDEO =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|spalla\.io|pandavideo\.com(\.br)?|wistia\.(com|net)|vdocipher\.com|vturb\.com(\.br)?|bunnycdn\.com|mediadelivery\.net|dailymotion\.com|loom\.com|streamable\.com|kinescope\.io|jwplayer\.com|brightcove\.(com|net))$/i;
// Links de um site que nunca são aula (conta, carrinho, termos, redes sociais).
const DESCARTAR = /\/(login|logout|signin|signup|cadastro|conta|account|carrinho|cart|checkout|termos|terms|privacidade|privacy|politica|ajuda|help|contato|contact)(\/|\?|$)/i;
const REDES = /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|whatsapp\.com|wa\.me|t\.me|pinterest\.com|google\.com|apple\.com)$/i;

export interface Candidato {
  url: string;
  /** Embutido na página (iframe, <video>): vai primeiro, é o player da própria página. */
  embutido: boolean;
  /** O texto do link, para dar título ao vídeo quando o yt-dlp não acha um bom. */
  texto: string | null;
}

const decodificar = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const textoDe = (html: string) =>
  decodificar(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Puro: o HTML e o endereço dele entram, os candidatos saem, na ordem da página. */
export function candidatosDaPagina(html: string, base: string, max = 120): Candidato[] {
  let origem: URL;
  try {
    origem = new URL(base);
  } catch {
    return [];
  }
  const vistos = new Set<string>([semHash(origem.href)]);
  const embutidos: Candidato[] = [];
  const links: Candidato[] = [];

  const aceitar = (bruto: string, embutido: boolean, texto: string | null) => {
    let u: URL;
    try {
      u = new URL(decodificar(bruto.trim()), origem);
    } catch {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    const chave = semHash(u.href);
    if (vistos.has(chave)) return;
    if (NAO_VIDEO.test(u.pathname)) return;
    const mesmoSite = dominio(u.hostname) === dominio(origem.hostname);
    const deVideo = HOSTS_DE_VIDEO.test(u.hostname) || MIDIA.test(u.pathname);
    if (!embutido) {
      if (REDES.test(u.hostname) && !deVideo) return;
      if (!mesmoSite && !deVideo) return;
      if (DESCARTAR.test(u.pathname)) return;
    }
    vistos.add(chave);
    (embutido ? embutidos : links).push({ url: chave, embutido, texto: texto || null });
  };

  for (const m of html.matchAll(/<(iframe|video|source|embed)\b[^>]*?\s(?:src|data-src)\s*=\s*["']([^"']+)["']/gi)) aceitar(m[2], true, null);
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    aceitar(m[1], false, textoDe(m[2]).slice(0, 200));
  }
  // Players montados por script deixam a URL do vídeo solta no HTML.
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi)) aceitar(m[0], true, null);

  return [...embutidos, ...links].slice(0, max);
}

const semHash = (href: string) => href.split('#')[0];

// "aulas.site.com.br" e "site.com.br" são o mesmo site para quem lista as aulas.
function dominio(host: string): string {
  const partes = host.toLowerCase().replace(/^www\./, '').split('.');
  const curto = partes.length >= 3 && partes[partes.length - 1].length === 2 && partes[partes.length - 2].length <= 3;
  return partes.slice(curto ? -3 : -2).join('.');
}

// Muitos sites devolvem uma página vazia (ou bloqueiam) para quem não parece navegador.
const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

/** O HTML da página, ou null se não for uma página (vídeo direto, erro, fora do ar). */
export async function lerPagina(url: string, signal?: AbortSignal): Promise<{ html: string; url: string } | null> {
  try {
    const res = await fetch(url, { headers: CABECALHOS, redirect: 'follow', signal: signal ?? AbortSignal.timeout(30_000) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    return { html: (await res.text()).slice(0, 5_000_000), url: res.url || url };
  } catch {
    return null;
  }
}
