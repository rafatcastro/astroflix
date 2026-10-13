// Os campos do Anki são HTML; o Learnflix guarda texto puro. A ida escapa e
// troca a quebra de linha por <br>; a volta faz o caminho contrário, para que o
// card editado no Anki apareça certo no app (formatação fica para trás).

export function paraHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '<br>');
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

export function deHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    // O editor do Anki abre um <div> por linha nova: a abertura é a quebra.
    .replace(/<(div|p|li)(\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTIDADES[e.toLowerCase()] ?? m;
    })
    .replace(/^\n+|\n+$/g, '');
}

/** Nome do baralho: `::` no título criaria subbaralhos no Anki. */
export const BARALHO_RAIZ = 'Learnflix::Cursos';
export function baralhoDoCurso(titulo: string | null): string {
  if (!titulo) return BARALHO_RAIZ;
  const limpo = titulo.replace(/::/g, ':').replace(/\s+/g, ' ').trim();
  return limpo ? `${BARALHO_RAIZ}::${limpo}` : BARALHO_RAIZ;
}

export function formatarMinuto(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
