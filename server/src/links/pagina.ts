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
export function dominio(host: string): string {
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

/** O que voltou ao abrir a página: o log e o "print" (o HTML salvo) saem daqui. */
export interface RespostaPagina {
  /** O HTML, só quando é uma página que respondeu 2xx. */
  html: string | null;
  /** O endereço final, depois dos redirecionamentos. */
  url: string;
  status: number | null;
  tipo: string | null;
  bytes: number;
  /** O corpo recebido (até 5 MB), mesmo num erro: a página de login ou de 403 também diz algo. */
  corpo: string;
  erro: string | null;
}

export async function lerPagina(url: string, signal?: AbortSignal, login?: Cabecalho | null): Promise<RespostaPagina> {
  try {
    const headers: Record<string, string> = { ...CABECALHOS };
    if (login) headers[login.nome] = login.valor;
    const res = await fetch(url, { headers, redirect: 'follow', signal: signal ?? AbortSignal.timeout(30_000) });
    const tipo = res.headers.get('content-type');
    const ehTexto = !tipo || /html|text|json|xml/i.test(tipo);
    const corpo = ehTexto ? (await res.text()).slice(0, 5_000_000) : '';
    if (!ehTexto) await res.body?.cancel();
    const pagina = res.ok && (tipo ?? '').includes('html');
    return { html: pagina ? corpo : null, url: res.url || url, status: res.status, tipo, bytes: corpo.length, corpo, erro: null };
  } catch (e) {
    return { html: null, url, status: null, tipo: null, bytes: 0, corpo: '', erro: e instanceof Error ? `${e.name}: ${e.message}` : 'falhou' };
  }
}

export interface Cabecalho {
  nome: string;
  valor: string;
}

/**
 * O "Token de login" da janela de importar, no formato que a pessoa tiver em mãos
 * (o DevTools mostra os três): a linha inteira ("Authorization: Bearer x",
 * "Cookie: a=b"), só os cookies ("a=b; c=d") ou só o token (vira Bearer).
 */
export function cabecalhoDeLogin(texto: string | null | undefined): Cabecalho | null {
  const t = (texto ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!t) return null;
  const linha = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.+)$/.exec(t);
  if (linha && !/^https?$/i.test(linha[1])) return { nome: linha[1], valor: linha[2].trim() };
  // Um token em base64 termina em "=" e não é cookie.
  if (!/=+$/.test(t) && /^[^\s=;]+=[^;]*(;\s*[^\s=;]+=[^;]*)*;?$/.test(t)) return { nome: 'Cookie', valor: t };
  return { nome: 'Authorization', valor: /^bearer\s/i.test(t) ? t : `Bearer ${t}` };
}

/** O login vai só para o site do link colado e para o player embutido na página dele. */
/** Para o log: o nome do cabeçalho e só o fim do valor (o token nunca vai inteiro para o disco do log). */
export const loginMascarado = (c: Cabecalho) => `${c.nome}: …${c.valor.slice(-4)} (${c.valor.length} caracteres)`;

export function mandaLogin(url: string, link: string, embutidos: Set<string>): boolean {
  try {
    const h = new URL(url).hostname;
    return dominio(h) === dominio(new URL(link).hostname) || embutidos.has(h);
  } catch {
    return false;
  }
}
