const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** O primeiro número do nome ("[Novo VTSD] - 03. Introdução" → 3), ou null. */
export function numeroDoNome(nome: string): number | null {
  const m = /\d+/.exec(nome);
  return m ? Number(m[0]) : null;
}

// A ordem natural compara o texto antes do número: "[Curso] - 10. X" vinha
// antes de "[Curso] - 2. Y" quando o prefixo mudava, e "Aula 3" antes de
// "Módulo 1". Quem numera as pastas quer a ordem dos números, em qualquer
// ponto do nome; o que não tem número vai depois, e o empate cai na natural.
export function compararNomes(a: string, b: string): number {
  const na = numeroDoNome(a);
  const nb = numeroDoNome(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na === null && nb !== null) return 1;
  if (na !== null && nb === null) return -1;
  return naturalCompare(a, b);
}

/** Pasta por pasta: "A/B/x" e "A/C/y" se ordenam por A, depois por B e C. */
export function compararCaminhos(a: string, b: string): number {
  const sa = a.split('/').filter(Boolean);
  const sb = b.split('/').filter(Boolean);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const c = compararNomes(sa[i], sb[i]);
    if (c !== 0) return c;
  }
  return sa.length - sb.length;
}
