// Os campos do Anki são HTML; o Astroflix guarda texto puro. A ida escapa e
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

// Baralhos: Astroflix::<categoria> guarda as questões gerais da categoria, e cada
// curso ou PDF tem o seu embaixo, em Cursos ou PDFs. Revisar a categoria pega
// tudo dela. Sem categoria vai para "Sem categoria"; o card geral sem categoria
// nenhuma, para a raiz.
export const BARALHO_RAIZ = 'Astroflix';
export const SEM_CATEGORIA = 'Sem categoria';
/** A estrutura antiga (até a v2.1.25): os cards de lá são movidos para a nova. */
export const BARALHO_ANTIGO = 'Learnflix::Cursos';
/** A raiz de quando o app se chamava Learnflix (até a v2.1.28): os cards vêm para Astroflix. */
export const RAIZ_ANTIGA = 'Learnflix';

/** `::` no nome criaria subbaralhos no Anki. */
const limpar = (nome: string) => nome.replace(/::/g, ':').replace(/\s+/g, ' ').trim();

export interface OrigemDoCard {
  /** Nome da categoria; null = sem categoria. */
  categoria: string | null;
  curso?: string | null;
  pdf?: string | null;
  /** Card geral sem categoria: vai para a raiz. */
  geral?: boolean;
}

export function baralhoDe(o: OrigemDoCard): string {
  if (o.geral && !o.categoria) return BARALHO_RAIZ;
  const categoria = `${BARALHO_RAIZ}::${(o.categoria && limpar(o.categoria)) || SEM_CATEGORIA}`;
  if (o.curso && limpar(o.curso)) return `${categoria}::Cursos::${limpar(o.curso)}`;
  if (o.pdf && limpar(o.pdf)) return `${categoria}::PDFs::${limpar(o.pdf)}`;
  return categoria;
}

export function formatarMinuto(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
