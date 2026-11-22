import type { LessonDTO, MaterialDTO } from '../api/client';

export type No =
  | Pasta
  | { tipo: 'aula'; aula: LessonDTO; titulo: string; anexos: MaterialDTO[] }
  | { tipo: 'material'; material: MaterialDTO };

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

export type Origem = 'local' | 'drive' | 'telegram';

const pastasDe = (relPath: string) => relPath.split('/').filter(Boolean).slice(0, -1);
const nomeDe = (relPath: string) => relPath.split('/').filter(Boolean).pop() ?? relPath;
// "02. Seu 1º Projeto Python - Automação…" e "02. Seu 1º Projeto Python - Automação… - Telegram @x.mp4" começam igual.
const comparavel = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const comparar = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' }).compare;

// Os tipos que viram a descrição da aula (o texto embaixo do vídeo).
export const DESCRICAO = /\.(txt|md|markdown|pdf|docx)$/i;
// Os documentos que podem ser de uma aula (descrição ou anexo). O .doc antigo o
// visualizador não abre: liga à aula, mas só como anexo.
export const DOCUMENTO = /\.(txt|md|markdown|pdf|docx?)$/i;
// A pasta que guarda os arquivos de apoio ("Materiais", "Material de apoio", "Anexos"):
// o arquivo dentro dela é das aulas da pasta de fora, não de uma pasta própria. Só
// quando o nome começa assim (fora o número): "03 Ciência dos Materiais" é um módulo.
const MATERIAIS = /^(materia(l|is)|apoio|anexos?)\b/i;
const ehPastaDeMateriais = (pasta: string) => MATERIAIS.test(pasta.replace(/^\d+[\s.\-_]*/, ''));
// Texto antes de Word, Word antes de PDF: o .txt costuma ser a descrição escrita, e
// o PDF, os slides.
const prioridadeDaDescricao = (relPath: string) => (/\.(txt|md|markdown)$/i.test(relPath) ? 0 : /\.docx$/i.test(relPath) ? 1 : 2);
// "0000000123-Aula 1.mp4" e "0000000124-Aula 1.txt" (Telegram) também são o mesmo nome.
const baseDe = (relPath: string) => comparavel(nomeDe(relPath).replace(/\.[^.]+$/, '').replace(/^\d{10}-/, ''));

// "01. Aula 01 - Introdução - Descrição - Catálogo….txt" é a descrição de
// "01. Aula 01 - Introdução - Catálogo….mp4": a palavra "Descrição" não conta.
const semDescricao = (base: string) => base.replace(/descric(ao|oes)|description|resumo/g, '');
// "Aula 01", "aula 1", "Aula-1": o número da aula, para ligar quando o resto do nome muda.
const numeroDaAula = (relPath: string): number | null => {
  const m = nomeDe(relPath)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .match(/\baula\s*[-_.#]?\s*0*(\d+)/i);
  return m ? Number(m[1]) : null;
};

/**
 * Os arquivos que são de uma aula. Um documento (txt, md, pdf, doc, docx) é da aula
 * quando cita ela: o mesmo nome do vídeo, o nome sem a palavra "Descrição" ou, por
 * último, o mesmo "Aula N". Ele é procurado na pasta dele, na pasta de fora de uma
 * pasta de materiais ("Mod/Materiais/x.pdf" é de "Mod"; "Materiais/Mod/x.pdf"
 * também), uma e duas pastas acima e, se só uma aula do curso tem aquele nome ou
 * aquele número, no curso todo. Os arquivos guardados numa pasta com o nome da aula
 * ("Módulo/materiais/02. Seu 1º Projeto/Gabarito.ipynb") também são dela.
 * Da aula, o primeiro texto (txt/md, depois docx, depois pdf) é a descrição, que
 * aparece embaixo do vídeo; os outros são anexos, logo abaixo dela na lista.
 */
export function ligacoesDasAulas(
  aulas: LessonDTO[],
  materiais: MaterialDTO[],
): { descricoes: Map<string, MaterialDTO>; anexos: Map<string, MaterialDTO[]> } {
  const chaves: Array<(relPath: string) => string | null> = [
    (r) => baseDe(r),
    (r) => semDescricao(baseDe(r)) || null,
    (r) => {
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
  // Sem achar por perto, vale o nome (ou o "Aula N") no curso todo, se só uma aula o
  // tem ("Docker/Materiais de apoio/1/1.11. O que é Docker Hub.txt" é da aula
  // "Docker/01 Primeiros passos/1.11. O que é Docker Hub.mp4").
  const unicoNoCurso = (chave: (r: string) => string | null) => {
    const mapa = new Map<string, LessonDTO | null>();
    for (const l of aulas) {
      const k = chave(l.relPath);
      if (k) mapa.set(k, mapa.has(k) ? null : l);
    }
    return mapa;
  };
  const noCurso = [null, unicoNoCurso(chaves[1]), unicoNoCurso(chaves[2])];

  const porCaminho = new Map(materiais.map((m) => [m.relPath, m]));
  const doMaterial = new Map<string, LessonDTO>();
  const ligar = (aula: LessonDTO | null | undefined, m: MaterialDTO) => {
    if (!aula || doMaterial.has(m.id)) return false;
    doMaterial.set(m.id, aula);
    return true;
  };
  // A escolha feita no mapeamento (MapearCurso) vale antes de qualquer palpite pelo
  // nome; "Nenhuma" ('') também: a aula fica sem descrição (os arquivos dela, anexos).
  const escolhida = new Map<string, MaterialDTO | null>();
  for (const l of aulas) {
    if (typeof l.descricao !== 'string') continue;
    const m = l.descricao ? porCaminho.get(l.descricao) : undefined;
    if (m && ligar(l, m)) escolhida.set(l.id, m);
    else escolhida.set(l.id, null);
  }

  // As pastas onde procurar a aula, da mais perto para a mais longe.
  const ondeProcurar = (relPath: string): string[] => {
    const pastas = pastasDe(relPath);
    const lugares = [pastas, pastas.filter((p) => !ehPastaDeMateriais(p)), pastas.slice(0, -1), pastas.slice(0, -2)];
    if (pastas.length < 1) lugares.splice(2);
    else if (pastas.length < 2) lugares.splice(3);
    return [...new Set(lugares.map((p) => p.join('/')))];
  };
  const candidatos = materiais.filter((m) => DOCUMENTO.test(m.relPath));
  // Uma passada por regra, da mais exata para a mais solta: o "A.txt" ganha do
  // "Aula 1 - slides.pdf" mesmo que o PDF venha antes na lista. Todas as passadas por
  // pasta vêm antes das do curso todo: o "Mod2/Aula 03.txt" é do "Mod2/Aula 03 -
  // Intro.mp4" (mesmo "Aula 3" na pasta dele), e não do "Mod1/Aula 03.mp4", que só
  // tem o mesmo nome em outra pasta.
  chaves.forEach((chave, i) => {
    for (const m of candidatos) {
      if (doMaterial.has(m.id)) continue;
      const k = chave(m.relPath);
      if (!k) continue;
      for (const pasta of ondeProcurar(m.relPath)) {
        if (ligar(indices[i].get(`${pasta}\n${k}`), m)) break;
      }
    }
  });
  chaves.forEach((chave, i) => {
    const curso = noCurso[i];
    if (!curso) return;
    for (const m of candidatos) {
      const k = chave(m.relPath);
      // Um nome curto ("aula", "intro") daria ligação errada no curso todo.
      if (k && (i === 2 || k.length >= 6)) ligar(curso.get(k), m);
    }
  });

  // Arquivos guardados numa pasta com o nome da aula, logo abaixo da pasta dela
  // ("Módulo/02. Aula/arquivo") ou com uma pasta de materiais no meio
  // ("Módulo/materiais/02. Aula/arquivo"), são dela, seja qual for o tipo.
  const aulasPorPasta = new Map<string, Array<{ nome: string; aula: LessonDTO }>>();
  for (const l of aulas) {
    const chave = pastasDe(l.relPath).join('/');
    const lista = aulasPorPasta.get(chave) ?? [];
    lista.push({ nome: comparavel(nomeDe(l.relPath)), aula: l });
    aulasPorPasta.set(chave, lista);
  }
  for (const m of materiais) {
    if (doMaterial.has(m.id)) continue;
    const caminho = pastasDe(m.relPath);
    const pastaDoArquivo = comparavel(caminho[caminho.length - 1] ?? '');
    if (pastaDoArquivo.length < 4) continue;
    for (const subir of [1, 2]) {
      if (subir > caminho.length) break;
      const acima = caminho.slice(0, caminho.length - subir).join('/');
      const achada = aulasPorPasta.get(acima)?.find((a) => a.nome.startsWith(pastaDoArquivo));
      if (achada) {
        ligar(achada.aula, m);
        break;
      }
    }
  }

  const daAula = new Map<string, MaterialDTO[]>();
  for (const m of materiais) {
    const l = doMaterial.get(m.id);
    if (!l) continue;
    const lista = daAula.get(l.id) ?? [];
    lista.push(m);
    daAula.set(l.id, lista);
  }
  const descricoes = new Map<string, MaterialDTO>();
  const anexos = new Map<string, MaterialDTO[]>();
  for (const [id, lista] of daAula) {
    let descricao: MaterialDTO | undefined;
    if (escolhida.has(id)) descricao = escolhida.get(id) ?? undefined;
    else
      descricao = lista
        .filter((m) => DESCRICAO.test(m.relPath))
        .sort((a, b) => prioridadeDaDescricao(a.relPath) - prioridadeDaDescricao(b.relPath))[0];
    if (descricao) descricoes.set(id, descricao);
    const resto = lista.filter((m) => m !== descricao).sort((a, b) => comparar(nomeDe(a.relPath), nomeDe(b.relPath)));
    if (resto.length) anexos.set(id, resto);
  }
  return { descricoes, anexos };
}

/** O arquivo que é a descrição de cada aula (ver ligacoesDasAulas). */
export function descricoesDasAulas(aulas: LessonDTO[], materiais: MaterialDTO[]): Map<string, MaterialDTO> {
  return ligacoesDasAulas(aulas, materiais).descricoes;
}

// O curso como as pastas dele: A > [B, C, D], em qualquer profundidade. Local e
// Drive seguem as pastas do disco (rel_path); o Telegram, que não tem pastas, segue o
// módulo ("A/B"), que é o tópico ou o que a pessoa montou no mapeamento. A ordem é a
// do servidor (order_index), então basta pendurar cada aula no caminho dela. A pasta
// que embrulha o curso inteiro (tudo dentro de "Docker/") não conta, senão tudo
// ficaria dentro de uma pasta só; no Telegram não há embrulho: o módulo único que a
// pessoa criou é dela.
// Os arquivos de uma aula ficam com ela (descrição embaixo do vídeo, anexos logo
// abaixo na lista); os outros ficam na pasta onde estão, depois das aulas, e a pasta
// só de arquivos ("Arquivos gerais") vai para o fim, depois das pastas com aula.
export function montarArvore(aulas: LessonDTO[], todosOsMateriais: MaterialDTO[] = [], origem: Origem = 'local'): No[] {
  const { descricoes, anexos } = ligacoesDasAulas(aulas, todosOsMateriais);
  const ligados = new Set([...descricoes.values(), ...[...anexos.values()].flat()].map((m) => m.id));
  const materiais = todosOsMateriais.filter((m) => !ligados.has(m.id));
  const caminhoDe = (l: LessonDTO) => (origem === 'telegram' ? (l.module?.split('/').filter(Boolean) ?? []) : pastasDe(l.relPath));
  // Um nível só: "Curso/02 DascIA/01 Fund" perde o "Curso", mas o "02 DascIA" é um
  // módulo de verdade, mesmo sendo o único.
  let comum = 0;
  if (origem !== 'telegram') {
    const pastas = [...aulas.map(caminhoDe), ...materiais.map((m) => pastasDe(m.relPath))];
    if (pastas.length && pastas.every((p) => p.length > 1 && p[0] === pastas[0][0])) comum = 1;
  }
  const raiz: Pasta = { tipo: 'pasta', chave: '', nome: '', filhos: [], aulas: [], materiais: 0 };
  const porChave = new Map<string, Pasta>();
  const pastaDe = (caminho: string[], aoPassar: (p: Pasta) => void): Pasta => {
    let atual = raiz;
    for (let n = comum; n < caminho.length; n++) {
      const chave = caminho.slice(0, n + 1).join('/');
      let pasta = porChave.get(chave);
      if (!pasta) {
        pasta = { tipo: 'pasta', chave, nome: caminho[n], filhos: [], aulas: [], materiais: 0 };
        porChave.set(chave, pasta);
        atual.filhos.push(pasta);
      }
      aoPassar(pasta);
      atual = pasta;
    }
    return atual;
  };
  for (const l of aulas) {
    const anexosDaAula = anexos.get(l.id) ?? [];
    const pasta = pastaDe(caminhoDe(l), (p) => {
      p.aulas.push(l);
      p.materiais += anexosDaAula.length;
    });
    // Curso ainda não re-escaneado: o título vem com as pastas coladas ("B / C — Aula").
    const prefixo = `${pastasDe(l.relPath).slice(1).join(' / ')} — `;
    const titulo = pastasDe(l.relPath).length > 1 && l.title.startsWith(prefixo) ? l.title.slice(prefixo.length) : l.title;
    pasta.filhos.push({ tipo: 'aula', aula: l, titulo, anexos: anexosDaAula });
  }
  for (const m of materiais) pastaDe(pastasDe(m.relPath), (p) => p.materiais++).filhos.push({ tipo: 'material', material: m });

  // Em cada pasta: as subpastas com aula e as aulas juntas, na ordem em que entraram
  // (a do servidor, que é a do "Próxima" no player: uma aula solta entre duas
  // subpastas fica entre elas); depois os arquivos soltos e, por fim, as pastas só de
  // arquivos, esses dois pela ordem natural do nome ("03 Material" depois de "02", e
  // não entre as aulas).
  const grupo = (no: No) => (no.tipo === 'pasta' ? (no.aulas.length ? 0 : 3) : no.tipo === 'aula' ? 0 : 2);
  const nomeDoNo = (no: No) => (no.tipo === 'pasta' ? no.nome : no.tipo === 'material' ? nomeDe(no.material.relPath) : '');
  const ordenar = (pasta: Pasta) => {
    pasta.filhos = pasta.filhos
      .map((no, i) => ({ no, i }))
      .sort((a, b) => {
        const g = grupo(a.no) - grupo(b.no);
        if (g) return g;
        if (grupo(a.no) >= 2) return comparar(nomeDoNo(a.no), nomeDoNo(b.no)) || a.i - b.i;
        return a.i - b.i;
      })
      .map((x) => x.no);
    for (const f of pasta.filhos) if (f.tipo === 'pasta') ordenar(f);
  };
  ordenar(raiz);
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
