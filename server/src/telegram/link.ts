import type { LinkTelegram } from './tipos';

// Caminhos de t.me que não são grupo nem canal: sem esta lista, "t.me/addstickers/x"
// viraria uma busca pelo usuário "addstickers".
const RESERVADOS = new Set(['addstickers', 'addemoji', 'addtheme', 'share', 'proxy', 'socks', 'login', 'iv', 'setlanguage', 'bg', 'invoice']);

// Regra do Telegram para nome de usuário: 4 a 32, letras/números/_, começando por letra.
const USUARIO = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

export function parseLinkTelegram(texto: string): LinkTelegram | null {
  const t = texto.trim();
  if (!t) return null;
  if (t.startsWith('@')) {
    const u = t.slice(1);
    return USUARIO.test(u) ? { tipo: 'publico', usuario: u } : null;
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 't.me' && host !== 'telegram.me') return null;

  const segs = url.pathname.split('/').filter(Boolean);
  const [primeiro, segundo] = segs;
  if (!primeiro) return null;

  if (primeiro.startsWith('+')) {
    const hash = primeiro.slice(1);
    return /^[\w-]+$/.test(hash) ? { tipo: 'convite', hash } : null;
  }
  if (primeiro === 'joinchat') return segundo && /^[\w-]+$/.test(segundo) ? { tipo: 'convite', hash: segundo } : null;
  if (primeiro === 'c') return segundo && /^\d+$/.test(segundo) ? { tipo: 'privado', canalId: segundo, ...numeros(segs.slice(2), url) } : null;
  if (RESERVADOS.has(primeiro.toLowerCase())) return null;
  return USUARIO.test(primeiro) ? { tipo: 'publico', usuario: primeiro, ...numeros(segs.slice(1), url) } : null;
}

// O que vem depois do grupo: /<mensagem>, /<tópico>/<mensagem> ou ?thread=<tópico>.
function numeros(resto: string[], url: URL): { mensagem?: number; topico?: number } {
  const n = resto.filter((s) => /^\d+$/.test(s)).map(Number);
  const thread = Number(url.searchParams.get('thread') ?? url.searchParams.get('topic'));
  const r: { mensagem?: number; topico?: number } = {};
  if (n.length) r.mensagem = n[n.length - 1];
  if (n.length >= 2) r.topico = n[0];
  else if (thread > 0) r.topico = thread;
  return r;
}
