import type { LessonDTO, MaterialDTO } from '../api/client';

export type No = Pasta | { tipo: 'aula'; aula: LessonDTO; titulo: string } | { tipo: 'material'; material: MaterialDTO };

export interface Pasta {
  tipo: 'pasta';
  chave: string;
  nome: string;
  filhos: No[];
  /** Todas as aulas de dentro, em qualquer nível (para o "feitas/total"). */
  aulas: LessonDTO[];
  /** Quantos arquivos (PDF, imagem, anexo) há dentro, em qualquer nível. */
  materiais: number;
}

const pastasDe = (relPath: string) => relPath.split('/').filter(Boolean).slice(0, -1);
const nomeDe = (relPath: string) => relPath.split('/').filter(Boolean).pop() ?? relPath;
// "02. Seu 1º Projeto Python - Automação…" e "02. Seu 1º Projeto Python - Automação… - Telegram @x.mp4" começam igual.
const comparavel = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const comparar = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' }).compare;

// O curso como as pastas dele: A > [B, C, D], em qualquer profundidade. A ordem
// é a do servidor (order_index, que segue o número de cada pasta), então basta
// pendurar cada aula no caminho dela. A pasta que embrulha o curso inteiro (ex.:
// tudo dentro de "Docker/") não conta, senão tudo ficaria dentro de uma pasta só.
// O título perde o prefixo de pasta que o deriveCourse dobrou nele ("B / C — Aula").
// Os arquivos que não são vídeo ficam na pasta onde estão, junto das aulas (antes
// iam para "Materiais adicionais", e uma pasta só de PDFs sumia da lista), e a
// pasta com um vídeo só continua pasta: o nome dela é o do módulo.
// Os tipos que viram a descrição da aula (o texto embaixo do vídeo).
const DESCRICAO = /\.(txt|md|markdown|pdf|docx)$/i;
// "0000000123-Aula 1.mp4" e "0000000124-Aula 1.txt" (Telegram) também são o mesmo nome.
const baseDe = (relPath: string) => comparavel(nomeDe(relPath).replace(/\.[^.]+$/, '').replace(/^\d{10}-/, ''));

// "01. Aula 01 - Introdução - Descrição - Catálogo….txt" é a descrição de
// "01. Aula 01 - Introdução - Catálogo….mp4": a palavra "Descrição" não conta.
const semDescricao = (base: string) => base.replace(/descric(ao|oes)|description|resumo/g, '');
// "Aula 01", "aula 1", "Aula-1": o número da aula, para ligar quando o resto do nome muda.
const numeroDaAula = (relPath: string): number | null => {
  const m = nomeDe(relPath)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/\baula\s*[-_.#]?\s*0*(\d+)/i);
  return m ? Number(m[1]) : null;
};

/**
 * O arquivo de texto com o mesmo nome do vídeo ("A.mp4" e "A.txt", ao lado dele,
 * dentro de uma pasta como "materiais/" ou "materiais/A/", ou em qualquer lugar do
 * curso se só uma aula se chama assim) é a descrição da aula:
 * aparece embaixo do vídeo, e não como item da lista. Um por aula. Na falta do
 * mesmo nome, vale o nome sem a palavra "Descrição" e, por último, o mesmo
 * "Aula N" na mesma pasta (quando só uma aula da pasta tem esse número).
 */
export function descricoesDasAulas(aulas: LessonDTO[], materiais: MaterialDTO[]): Map<string, MaterialDTO> {
  const chaves: Array<(relPath: string) => string | null> = [
    (r) => baseDe(r),
    (r) => semDescricao(baseDe(r)) || null,
    // Só texto: "Aula 1 - Slides.pdf" é material, não a descrição.
    (r) => {
      if (!/\.(txt|md|markdown)$/i.test(r)) return null;
      const n = numeroDaAula(r);
      return n === null ? null : `aula#${n}`;
    },
  ];
  // Por pasta e por chave; null quando duas aulas da pasta dão a mesma chave.
  const indices = chaves.map((chave) => {
    const porPasta = new Map<string, LessonDTO | null>();
    for (const l of aulas) {
      const k = chave(l.relPath);
      if (!k) continue;
      const id = `${pastasDe(l.relPath).join('/')}\n${k}`;
      porPasta.set(id, porPasta.has(id) ? null : l);
    }
    return porPasta;
  });
  // Sem achar por perto, vale o nome no curso todo, se só uma aula tem esse nome
  // ("Docker/Materiais de apoio/1/1.11. O que é Docker Hub.txt" é da aula
  // "Docker/01 Primeiros passos/1.11. O que é Docker Hub.mp4").
  const noCurso = new Map<string, LessonDTO | null>();
  for (const l of aulas) {
    const b = semDescricao(baseDe(l.relPath));
    noCurso.set(b, noCurso.has(b) ? null : l);
  }
  const candidatos = materiais.filter((m) => DESCRICAO.test(m.relPath));
  const descricoes = new Map<string, MaterialDTO>();
  const usados = new Set<string>();
  const ligar = (aula: LessonDTO | null | undefined, m: MaterialDTO) => {
    if (!aula || descricoes.has(aula.id) || usados.has(m.id)) return;
    descricoes.set(aula.id, m);
    usados.add(m.id);
  };
  // Uma passada por regra, da mais exata para a mais solta: o "A.txt" ganha do
  // "Aula 1 - slides.pdf" mesmo que o PDF venha antes na lista.
  chaves.forEach((chave, i) => {
    for (const m of candidatos) {
      const k = chave(m.relPath);
      if (!k) continue;
      const pastas = pastasDe(m.relPath);
      for (const subir of [0, 1, 2]) {
        if (subir > pastas.length) break;
        const aula = indices[i].get(`${pastas.slice(0, pastas.length - subir).join('/')}\n${k}`);
        if (aula) {
          ligar(aula, m);
          break;
        }
      }
    }
    if (i === 1) {
      for (const m of candidatos) {
        const b = semDescricao(baseDe(m.relPath));
        if (b.length >= 6) ligar(noCurso.get(b), m);
      }
    }
  });
  return descricoes;
}

export function montarArvore(aulas: LessonDTO[], todosOsMateriais: MaterialDTO[] = []): No[] {
  const descricoes = new Set([...descricoesDasAulas(aulas, todosOsMateriais).values()].map((m) => m.id));
  const materiais = todosOsMateriais.filter((m) => !descricoes.has(m.id));
  const pastas = [...aulas.map((l) => pastasDe(l.relPath)), ...materiais.map((m) => pastasDe(m.relPath))];
  let comum = 0;
  while (pastas.length && pastas.every((p) => p.length > comum + 1 && p[comum] === pastas[0][comum])) comum++;
  const raiz: Pasta = { tipo: 'pasta', chave: '', nome: '', filhos: [], aulas: [], materiais: 0 };
  const porChave = new Map<string, Pasta>();
  // A pasta das aulas segue a ordem do servidor (no Telegram, a dos tópicos). A
  // que só tem arquivos entra entre as irmãs pela ordem natural do nome: "03
  // Material" não vai para o fim, depois da "05".
  const pastaDe = (caminho: string[], aoPassar: (p: Pasta) => void, ordenar: boolean): Pasta => {
    let atual = raiz;
    for (let n = comum; n < caminho.length; n++) {
      const chave = caminho.slice(0, n + 1).join('/');
      let pasta = porChave.get(chave);
      if (!pasta) {
        pasta = { tipo: 'pasta', chave, nome: caminho[n], filhos: [], aulas: [], materiais: 0 };
        porChave.set(chave, pasta);
        const depois = ordenar ? atual.filhos.findIndex((f) => f.tipo === 'pasta' && comparar(f.nome, caminho[n]) > 0) : -1;
        if (depois < 0) atual.filhos.push(pasta);
        else atual.filhos.splice(depois, 0, pasta);
      }
      aoPassar(pasta);
      atual = pasta;
    }
    return atual;
  };
  aulas.forEach((l) => {
    const caminho = pastasDe(l.relPath);
    const pasta = pastaDe(caminho, (p) => p.aulas.push(l), false);
    const prefixo = `${caminho.slice(1).join(' / ')} — `;
    const titulo = caminho.length > 1 && l.title.startsWith(prefixo) ? l.title.slice(prefixo.length) : l.title;
    pasta.filhos.push({ tipo: 'aula', aula: l, titulo });
  });
  // Arquivos guardados numa pasta com o nome da aula ("Módulo/materiais/02. Seu 1º
  // Projeto/Gabarito.ipynb", ao lado de "Módulo/02. Seu 1º Projeto….mp4") são dessa
  // aula: entram logo depois dela, na pasta dela, e a pasta "materiais" não aparece.
  const aulasPorPasta = new Map<string, Array<{ nome: string; no: No }>>();
  const percorrer = (nos: No[]) => {
    for (const no of nos) {
      if (no.tipo === 'pasta') percorrer(no.filhos);
      else if (no.tipo === 'aula') {
        const chave = pastasDe(no.aula.relPath).join('/');
        const lista = aulasPorPasta.get(chave) ?? [];
        lista.push({ nome: comparavel(nomeDe(no.aula.relPath)), no });
        aulasPorPasta.set(chave, lista);
      }
    }
  };
  percorrer(raiz.filhos);
  const aulaDaPasta = (caminho: string[]): { caminho: string[]; no: No } | null => {
    const pastaDoArquivo = comparavel(caminho[caminho.length - 1] ?? '');
    if (pastaDoArquivo.length < 4) return null;
    // A pasta da aula pode estar logo acima ("Módulo/02. Aula/arquivo") ou com uma
    // pasta de materiais no meio ("Módulo/materiais/02. Aula/arquivo").
    for (const subir of [1, 2]) {
      const acima = caminho.slice(0, caminho.length - subir);
      const achada = aulasPorPasta.get(acima.join('/'))?.find((a) => a.nome.startsWith(pastaDoArquivo));
      if (achada) return { caminho: acima, no: achada.no };
    }
    return null;
  };

  // O arquivo entra entre as aulas da pasta pela ordem do nome, como no Finder.
  materiais.forEach((m) => {
    const daAula = aulaDaPasta(pastasDe(m.relPath));
    if (daAula) {
      const pasta = pastaDe(daAula.caminho, (p) => p.materiais++, false);
      let i = pasta.filhos.indexOf(daAula.no) + 1;
      while (pasta.filhos[i]?.tipo === 'material') i++;
      pasta.filhos.splice(i, 0, { tipo: 'material', material: m });
      return;
    }
    const pasta = pastaDe(pastasDe(m.relPath), (p) => p.materiais++, true);
    const nome = nomeDe(m.relPath);
    const depois = pasta.filhos.findIndex(
      (f) => f.tipo !== 'pasta' && comparar(nomeDe(f.tipo === 'aula' ? f.aula.relPath : f.material.relPath), nome) > 0,
    );
    if (depois < 0) pasta.filhos.push({ tipo: 'material', material: m });
    else pasta.filhos.splice(depois, 0, { tipo: 'material', material: m });
  });
  return raiz.filhos;
}

/** As pastas que levam até a aula, de fora para dentro (para abrir o caminho dela). */
export function caminhoDaAula(nos: No[], id: string): string[] {
  for (const no of nos) {
    if (no.tipo === 'material') continue;
    if (no.tipo === 'aula') {
      if (no.aula.id === id) return [];
      continue;
    }
    if (!no.aulas.some((l) => l.id === id)) continue;
    return [no.chave, ...caminhoDaAula(no.filhos, id)];
  }
  return [];
}
