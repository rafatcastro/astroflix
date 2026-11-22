import type { MensagemTelegram } from './tipos';

/** Um módulo do "Menu" do canal: o título e as hashtags (minúsculas, sem "#") das aulas dele. */
export interface GuiaModulo {
  modulo: string;
  tags: string[];
}

const HASHTAG = /#([\p{L}\p{N}_]+)/gu;

/** As hashtags do texto, minúsculas, sem repetir, na ordem em que aparecem. */
export function hashtagsDe(texto: string): string[] {
  const vistas = new Set<string>();
  for (const m of texto.matchAll(HASHTAG)) vistas.add(m[1].toLowerCase());
  return [...vistas];
}

// "= Módulo 01", "• Módulo", "-" sozinho: os enfeites nas pontas não fazem parte do nome.
const ENFEITE_NAS_PONTAS = /^[\s=\-•*>]+|[\s=\-•*>]+$/g;

/**
 * Lê o texto do menu: uma linha sem hashtag abre um título, e as hashtags das
 * linhas seguintes pertencem ao último título. Título sem nenhuma hashtag depois
 * (o "Clique aqui…" do começo, o "Via @canal" do fim) não vira módulo.
 */
export function lerGuia(texto: string): GuiaModulo[] {
  const modulos: GuiaModulo[] = [];
  let atual: GuiaModulo | null = null;
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim()) continue;
    const tags = hashtagsDe(linha);
    if (!tags.length) {
      const nome = linha.replace(ENFEITE_NAS_PONTAS, '').replace(/\//g, '-').slice(0, 120).trim();
      // Linha que só tinha enfeite ("-") não é título: a pendente continua valendo.
      if (nome) atual = { modulo: nome, tags: [] };
      continue;
    }
    if (!atual) continue;
    if (!modulos.includes(atual)) modulos.push(atual);
    for (const t of tags) if (!atual.tags.includes(t)) atual.tags.push(t);
  }
  return modulos;
}

/**
 * O canal pode ter vários textos com hashtags (menu, avisos). O guia é o que
 * mais casa com as hashtags das aulas do curso; com menos de 3 não é guia, é
 * coincidência. Empate: o mais recente (maior id).
 */
export function escolherGuia(textos: MensagemTelegram[], tagsDoCurso: Set<string>): GuiaModulo[] | null {
  let melhor: { guia: GuiaModulo[]; casadas: number; id: number } | null = null;
  for (const t of textos) {
    const guia = lerGuia(t.legenda);
    const casadas = guia.reduce((n, g) => n + g.tags.filter((x) => tagsDoCurso.has(x)).length, 0);
    if (casadas < 3) continue;
    if (!melhor || casadas > melhor.casadas || (casadas === melhor.casadas && t.id > melhor.id)) {
      melhor = { guia, casadas, id: t.id };
    }
  }
  if (!melhor) return null;
  return melhor.guia
    .map((g) => ({ modulo: g.modulo, tags: g.tags.filter((x) => tagsDoCurso.has(x)) }))
    .filter((g) => g.tags.length > 0);
}
