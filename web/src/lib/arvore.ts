import type { LessonDTO } from '../api/client';

export type No = Pasta | { tipo: 'aula'; aula: LessonDTO; titulo: string };

export interface Pasta {
  tipo: 'pasta';
  chave: string;
  nome: string;
  filhos: No[];
  /** Todas as aulas de dentro, em qualquer nível (para o "feitas/total"). */
  aulas: LessonDTO[];
}

const pastasDe = (l: LessonDTO) => l.relPath.split('/').filter(Boolean).slice(0, -1);

// O curso como as pastas dele: A > [B, C, D], em qualquer profundidade. A ordem
// é a do servidor (order_index, que segue o número de cada pasta), então basta
// pendurar cada aula no caminho dela. A pasta que embrulha o curso inteiro (ex.:
// tudo dentro de "Docker/") não conta, senão tudo ficaria dentro de uma pasta só.
// O título perde o prefixo de pasta que o deriveCourse dobrou nele ("B / C — Aula"),
// e a pasta com um vídeo só vira a própria aula: "01 aula" não diz nada que o
// nome da pasta já não diga.
export function montarArvore(aulas: LessonDTO[]): No[] {
  const pastas = aulas.map(pastasDe);
  let comum = 0;
  while (pastas.length && pastas.every((p) => p.length > comum + 1 && p[comum] === pastas[0][comum])) comum++;
  const raiz: Pasta = { tipo: 'pasta', chave: '', nome: '', filhos: [], aulas: [] };
  const porChave = new Map<string, Pasta>();
  aulas.forEach((l, i) => {
    let atual = raiz;
    for (let n = comum; n < pastas[i].length; n++) {
      const chave = pastas[i].slice(0, n + 1).join('/');
      let pasta = porChave.get(chave);
      if (!pasta) {
        pasta = { tipo: 'pasta', chave, nome: pastas[i][n], filhos: [], aulas: [] };
        porChave.set(chave, pasta);
        atual.filhos.push(pasta);
      }
      pasta.aulas.push(l);
      atual = pasta;
    }
    const prefixo = `${pastas[i].slice(1).join(' / ')} — `;
    const titulo = pastas[i].length > 1 && l.title.startsWith(prefixo) ? l.title.slice(prefixo.length) : l.title;
    atual.filhos.push({ tipo: 'aula', aula: l, titulo });
  });
  return achatar(raiz.filhos);
}

function achatar(nos: No[]): No[] {
  return nos.map((no) => {
    if (no.tipo === 'aula') return no;
    const filhos = achatar(no.filhos);
    if (filhos.length === 1 && filhos[0].tipo === 'aula') return { ...filhos[0], titulo: no.nome };
    return { ...no, filhos };
  });
}

/** As pastas que levam até a aula, de fora para dentro (para abrir o caminho dela). */
export function caminhoDaAula(nos: No[], id: string): string[] {
  for (const no of nos) {
    if (no.tipo === 'aula') {
      if (no.aula.id === id) return [];
      continue;
    }
    if (!no.aulas.some((l) => l.id === id)) continue;
    return [no.chave, ...caminhoDaAula(no.filhos, id)];
  }
  return [];
}
