import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { CourseDetail, MapaModulo, MaterialDTO } from '../api/client';
import { DESCRICAO, descricoesDasAulas } from '../lib/arvore';
import TextField from './TextField';

// O mapeamento do curso do Telegram: abre sozinho depois de importar e pelo menu ⋯
// ("Organizar módulos e aulas"). O canal não tem pastas, então é aqui que o curso
// ganha estrutura: a pessoa divide as aulas em módulos e submódulos, arrasta (ou
// marca várias e move de uma vez), renomeia e liga um arquivo como a descrição da
// aula, que então sai da lista do curso. Fica no app, e o "Baixar" segue a mesma
// estrutura, uma pasta por nível (routes/mapa.ts).

interface Aula {
  id: string;
  titulo: string;
  relPath: string;
  /** rel_path do arquivo que é a descrição; '' = nenhuma. */
  descricao: string;
  missing: boolean;
}
interface Grupo {
  chave: string;
  /**
   * O caminho do módulo, "A/B" para o submódulo B de A (é o que vai para o
   * servidor). null = fora dos módulos (vem antes de todos).
   */
  nome: string | null;
  /** O nome deste nível, o que a pessoa edita. */
  parte: string;
  /**
   * A chave do módulo pai (null = primeiro nível). O caminho é refeito a partir
   * dela: só pelo texto, renomear um módulo para o nome de um irmão juntaria os
   * submódulos dos dois no meio da digitação.
   */
  pai: string | null;
  aulas: Aula[];
}

// Cinco níveis, como o servidor aceita (nomeDoModulo em routes/mapa.ts).
const MAX_NIVEIS = 5;
// O recuo de cada nível, por extenso para o Tailwind achar as classes.
const RECUO = ['', 'pl-[1rem]', 'pl-[2rem]', 'pl-[3rem]', 'pl-[4rem]'];

let proximaChave = 0;
const novaChave = () => `g${++proximaChave}`;

/** Refaz os caminhos pelos pais (o pai sempre vem antes na lista). */
function comCaminhos(gs: Grupo[]): Grupo[] {
  const caminho = new Map<string, string>();
  return gs.map((g) => {
    if (g.nome === null) return g;
    const nome = g.pai !== null && caminho.has(g.pai) ? `${caminho.get(g.pai)}/${g.parte}` : g.parte;
    caminho.set(g.chave, nome);
    return g.nome === nome ? g : { ...g, nome };
  });
}

/**
 * A ordem de exibição: o "fora dos módulos" em cima e cada módulo seguido dos
 * seus submódulos, os irmãos na ordem em que estão na lista.
 */
function emOrdem(gs: Grupo[]): Grupo[] {
  const fora = gs.filter((g) => g.nome === null);
  const modulos = gs.filter((g) => g.nome !== null);
  const saida: Grupo[] = [...fora];
  const visitar = (pai: string | null) => {
    for (const g of modulos) {
      if (g.pai !== pai) continue;
      saida.push(g);
      visitar(g.chave);
    }
  };
  visitar(null);
  return comCaminhos(saida);
}

/** As chaves de todos os módulos debaixo deste, em qualquer nível. */
function descendentes(gs: Grupo[], chave: string): Set<string> {
  const achados = new Set<string>();
  for (const g of gs) if (g.pai !== null && (g.pai === chave || achados.has(g.pai))) achados.add(g.chave);
  return achados;
}

/** Quantos níveis o módulo tem (1 = primeiro nível). */
function nivelDe(gs: Grupo[], g: Grupo): number {
  let n = 1;
  for (let p = g.pai; p !== null; n++) p = gs.find((x) => x.chave === p)?.pai ?? null;
  return n;
}

const comoCaminho = (nome: string) => nome.split('/').join(' › ');
// A barra separa os níveis: dentro de um nome, vira hífen (também no servidor).
const semBarra = (t: string) => t.replace(/\//g, '-');

function gruposIniciais(curso: CourseDetail): Grupo[] {
  const aulas = curso.modules.flatMap((m) => m.lessons);
  const adivinhadas = descricoesDasAulas(aulas, curso.materials);
  const grupos: Grupo[] = [{ chave: novaChave(), nome: null, parte: '', pai: null, aulas: [] }];
  const porCaminho = new Map<string, Grupo>();
  // O módulo e cada pai dele, mesmo que o pai não tenha aula própria.
  const grupoDe = (caminho: string): Grupo => {
    const existente = porCaminho.get(caminho);
    if (existente) return existente;
    const partes = caminho.split('/');
    const pai = partes.length > 1 ? grupoDe(partes.slice(0, -1).join('/')) : null;
    const g: Grupo = { chave: novaChave(), nome: caminho, parte: partes[partes.length - 1], pai: pai?.chave ?? null, aulas: [] };
    porCaminho.set(caminho, g);
    grupos.push(g);
    return g;
  };
  for (const l of aulas) {
    // Sem mapeamento ainda, o módulo é o tópico (o que o scan derivou).
    const caminho = l.module
      ? l.module
          .split('/')
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, MAX_NIVEIS)
          .join('/')
      : '';
    const g = caminho ? grupoDe(caminho) : grupos[0];
    g.aulas.push({
      id: l.id,
      titulo: l.title,
      relPath: l.relPath,
      descricao: typeof l.descricao === 'string' ? l.descricao : (adivinhadas.get(l.id)?.relPath ?? ''),
      missing: l.missing,
    });
  }
  return emOrdem(grupos);
}

const botao =
  'rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40';
const botaoPequeno =
  'grid h-8 min-w-8 place-items-center rounded-md px-2 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-30';
const seletor =
  'h-8 max-w-[11rem] truncate rounded-md border border-neutral-700 bg-neutral-800 px-2 text-xs text-neutral-200 outline-none focus:ring-2 focus:ring-blue-600';

export default function MapearCurso({
  curso,
  primeiraVez,
  onSalvar,
  onPular,
  onFechar,
}: {
  curso: CourseDetail;
  /** Abriu sozinho depois de importar: o botão secundário é "Agora não". */
  primeiraVez: boolean;
  onSalvar: (modulos: MapaModulo[]) => Promise<void>;
  onPular: () => void;
  onFechar: () => void;
}) {
  const [grupos, setGrupos] = useState<Grupo[]>(() => gruposIniciais(curso));
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ultimaMarcada, setUltimaMarcada] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string[] | null>(null);
  const [alvo, setAlvo] = useState<{ grupo: string; antes: string | null } | null>(null);
  const [novoModulo, setNovoModulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mexeu, setMexeu] = useState(false);
  const campoNovo = useRef<HTMLInputElement>(null);
  // O submódulo recém-criado: o nome dele ganha o foco, para já digitar.
  const [focar, setFocar] = useState<string | null>(null);
  useEffect(() => {
    if (!focar) return;
    const campo = document.getElementById(`modulo-${focar}`) as HTMLInputElement | null;
    campo?.focus();
    campo?.select();
    setFocar(null);
  }, [focar]);

  // Os arquivos que podem ser a descrição (os que o app mostra como texto embaixo do vídeo).
  const arquivosDeDescricao = useMemo(
    () => curso.materials.filter((m) => DESCRICAO.test(m.relPath)).sort((a, b) => a.relPath.localeCompare(b.relPath, 'pt-BR', { numeric: true })),
    [curso.materials],
  );
  const nomeDoArquivo = (m: MaterialDTO) => m.relPath;

  const fechar = () => {
    if (primeiraVez) onPular();
    else onFechar();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || salvando) return;
      e.stopPropagation();
      if (mexeu && !confirm('Sair sem salvar o que você organizou?')) return;
      fechar();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const mudar = (f: (g: Grupo[]) => Grupo[]) => {
    setGrupos((g) => f(g));
    setMexeu(true);
  };
  const todasEmOrdem = grupos.flatMap((g) => g.aulas);
  const modulos = grupos.filter((g) => g.nome !== null);

  // Tira as aulas de onde estão e põe no grupo, antes de `antes` (null = no fim).
  const mover = (ids: string[], grupoChave: string, antes: string | null) =>
    mudar((gs) => {
      if (antes && ids.includes(antes)) return gs;
      const levadas = todasEmOrdem.filter((a) => ids.includes(a.id));
      const sem = gs.map((g) => ({ ...g, aulas: g.aulas.filter((a) => !ids.includes(a.id)) }));
      return sem.map((g) => {
        if (g.chave !== grupoChave) return g;
        const i = antes ? g.aulas.findIndex((a) => a.id === antes) : -1;
        const aulas = [...g.aulas];
        aulas.splice(i < 0 ? aulas.length : i, 0, ...levadas);
        return { ...g, aulas };
      });
    });

  const alterarAula = (id: string, patch: Partial<Aula>) =>
    mudar((gs) => gs.map((g) => ({ ...g, aulas: g.aulas.map((a) => (a.id === id ? { ...a, ...patch } : a)) })));

  const criarModulo = () => {
    const nome = semBarra(novoModulo).replace(/\s+/g, ' ').trim();
    if (!nome) return campoNovo.current?.focus();
    if (grupos.some((g) => g.nome?.toLowerCase() === nome.toLowerCase())) return setErro(`Já existe um módulo "${nome}".`);
    setErro(null);
    const chave = novaChave();
    mudar((gs) => [...gs, { chave, nome, parte: nome, pai: null, aulas: [] }]);
    setNovoModulo('');
    // Com aulas marcadas, o módulo novo já nasce com elas.
    if (marcadas.size) {
      const ids = [...marcadas];
      setTimeout(() => mover(ids, chave, null));
      setMarcadas(new Set());
    }
  };

  // "+ Submódulo": entra depois do último que já está debaixo do pai, com um nome
  // que não repete o de um irmão.
  const criarSubmodulo = (paiChave: string) => {
    const chave = novaChave();
    mudar((gs) => {
      const irmaos = gs.filter((g) => g.pai === paiChave).map((g) => g.parte.trim().toLowerCase());
      let parte = 'Novo submódulo';
      for (let n = 2; irmaos.includes(parte.toLowerCase()); n++) parte = `Novo submódulo ${n}`;
      const debaixo = descendentes(gs, paiChave);
      let fim = gs.findIndex((g) => g.chave === paiChave);
      gs.forEach((g, i) => {
        if (debaixo.has(g.chave)) fim = Math.max(fim, i);
      });
      const novo = [...gs];
      novo.splice(fim + 1, 0, { chave, nome: '', parte, pai: paiChave, aulas: [] });
      return comCaminhos(novo);
    });
    setFocar(chave);
  };
  // O nome é só deste nível; os submódulos mudam de caminho junto (comCaminhos).
  const renomearModulo = (chave: string, parte: string) =>
    mudar((gs) => comCaminhos(gs.map((g) => (g.chave === chave ? { ...g, parte: semBarra(parte) } : g))));
  // As aulas vão para o pai (ou para fora dos módulos, no primeiro nível) e os
  // submódulos sobem um nível, no mesmo lugar.
  const removerModulo = (chave: string) =>
    mudar((gs) => {
      const g = gs.find((x) => x.chave === chave);
      if (!g) return gs;
      const destino = g.pai ?? gs.find((x) => x.nome === null)?.chave;
      return comCaminhos(
        gs
          .filter((x) => x.chave !== chave)
          .map((x) => (x.chave === destino ? { ...x, aulas: [...x.aulas, ...g.aulas] } : x))
          .map((x) => (x.pai === chave ? { ...x, pai: g.pai } : x)),
      );
    });
  // Troca de lugar com o irmão de cima ou de baixo, levando os submódulos.
  const irmaoAo = (gs: Grupo[], g: Grupo, delta: -1 | 1) => {
    const irmaos = gs.filter((x) => x.nome !== null && x.pai === g.pai);
    return irmaos[irmaos.findIndex((x) => x.chave === g.chave) + delta];
  };
  const moverModulo = (chave: string, delta: -1 | 1) =>
    mudar((gs) => {
      const g = gs.find((x) => x.chave === chave);
      const outro = g && irmaoAo(gs, g, delta);
      if (!g || !outro) return gs;
      const novo = gs.map((x) => (x.chave === g.chave ? outro : x.chave === outro.chave ? g : x));
      return emOrdem(novo);
    });

  // Clique marca uma; com Shift, do último marcado até esta, na ordem da lista.
  const marcar = (id: string, shift: boolean) => {
    const novo = new Set(marcadas);
    if (shift && ultimaMarcada) {
      const ids = todasEmOrdem.map((a) => a.id);
      const [a, b] = [ids.indexOf(ultimaMarcada), ids.indexOf(id)].sort((x, y) => x - y);
      for (const x of ids.slice(a, b + 1)) novo.add(x);
    } else if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setMarcadas(novo);
    setUltimaMarcada(id);
  };

  const moverMarcadas = (grupoChave: string) => {
    if (!grupoChave) return;
    mover([...marcadas], grupoChave, null);
    setMarcadas(new Set());
  };

  // Arrastar uma aula marcada leva todas as marcadas.
  const aoArrastar = (id: string) => (e: DragEvent) => {
    const ids = marcadas.has(id) ? todasEmOrdem.filter((a) => marcadas.has(a.id)).map((a) => a.id) : [id];
    e.dataTransfer.setData('application/x-astroflix-mapa', ids.join(','));
    e.dataTransfer.effectAllowed = 'move';
    setArrastando(ids);
  };
  const soltarAqui = (grupo: string, antes: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!arrastando) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (alvo?.grupo !== grupo || alvo.antes !== antes) setAlvo({ grupo, antes });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = e.dataTransfer.getData('application/x-astroflix-mapa').split(',').filter(Boolean);
      setArrastando(null);
      setAlvo(null);
      if (ids.length) mover(ids, grupo, antes);
    },
  });

  // O caminho como vai para o servidor: cada nível sem os espaços das pontas.
  const caminhoLimpo = (nome: string) =>
    nome
      .split('/')
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .join('/');
  const salvar = async () => {
    if (modulos.some((g) => !g.parte.trim())) return setErro('Dê um nome a todos os módulos.');
    // Mesmo nome só conflita no mesmo pai: "A/Exercícios" e "B/Exercícios" são outros.
    const nomes = modulos.map((g) => caminhoLimpo(g.nome ?? '').toLowerCase());
    if (new Set(nomes).size !== nomes.length) return setErro('Dois módulos no mesmo lugar têm o mesmo nome.');
    setErro(null);
    setSalvando(true);
    try {
      // Só vão os módulos com aula própria: um vazio não teria pasta nem lugar na
      // lista, e o pai que só tem submódulos existe pelo caminho deles.
      await onSalvar(
        grupos
          .filter((g) => g.aulas.length)
          .map((g) => ({
            nome: g.nome === null ? null : caminhoLimpo(g.nome),
            aulas: g.aulas.map((a) => ({ id: a.id, titulo: a.titulo, descricao: a.descricao })),
          })),
      );
    } catch {
      setErro('Não foi possível salvar. Tente de novo.');
      setSalvando(false);
    }
  };

  // "1", "1.2", "1.2.1": a posição de cada módulo entre os irmãos, com a do pai.
  const numeroDoModulo = new Map<string, string>();
  {
    const contagem = new Map<string | null, number>();
    for (const g of modulos) {
      const n = (contagem.get(g.pai) ?? 0) + 1;
      contagem.set(g.pai, n);
      numeroDoModulo.set(g.chave, g.pai !== null ? `${numeroDoModulo.get(g.pai)}.${n}` : String(n));
    }
  }

  let numero = 0;
  const linha = (g: Grupo, a: Aula) => {
    numero++;
    const marcada = marcadas.has(a.id);
    const alvoAqui = alvo?.grupo === g.chave && alvo.antes === a.id;
    return (
      <li
        key={a.id}
        {...soltarAqui(g.chave, a.id)}
        className={`relative flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 sm:flex-nowrap ${marcada ? 'bg-blue-600/15' : 'bg-neutral-900'} ${
          arrastando?.includes(a.id) ? 'opacity-40' : ''
        } ${a.missing ? 'opacity-60' : ''}`}
      >
        {alvoAqui && <span aria-hidden className="absolute -top-1 left-2 right-2 h-0.5 rounded bg-blue-500" />}
        <input
          type="checkbox"
          checked={marcada}
          onChange={() => undefined}
          onClick={(e) => marcar(a.id, e.shiftKey)}
          className="h-4 w-4 shrink-0 accent-blue-600"
          aria-label={`Marcar "${a.titulo}"`}
        />
        <span
          draggable
          onDragStart={aoArrastar(a.id)}
          onDragEnd={() => {
            setArrastando(null);
            setAlvo(null);
          }}
          title="Arraste para outro lugar"
          className="cursor-grab select-none px-1 text-neutral-600 hover:text-neutral-300 active:cursor-grabbing"
          aria-hidden
        >
          ⠿
        </span>
        <span className="w-7 shrink-0 text-right text-xs tabular-nums text-neutral-600">{numero}</span>
        <input
          value={a.titulo}
          onChange={(e) => alterarAula(a.id, { titulo: e.target.value })}
          aria-label="Título da aula"
          title={a.relPath}
          className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-neutral-100 outline-none hover:border-neutral-700 focus:border-neutral-700 focus:bg-neutral-800 focus:ring-2 focus:ring-blue-600"
        />
        {a.missing && <span className="text-xs text-amber-300">arquivo não encontrado</span>}
        <select
          value={a.descricao}
          onChange={(e) => alterarAula(a.id, { descricao: e.target.value })}
          aria-label="Arquivo de descrição"
          title={a.descricao ? `Descrição: ${a.descricao}` : 'Sem descrição'}
          className={seletor}
        >
          <option value="">Sem descrição</option>
          {arquivosDeDescricao.map((m) => (
            <option key={m.id} value={m.relPath}>
              {nomeDoArquivo(m)}
            </option>
          ))}
        </select>
        <select
          value={g.chave}
          onChange={(e) => mover([a.id], e.target.value, null)}
          aria-label="Módulo"
          className={seletor}
        >
          {grupos.map((x) => (
            <option key={x.chave} value={x.chave}>
              {x.nome === null ? 'Fora dos módulos' : x.parte.trim() ? comoCaminho(x.nome) : '(sem nome)'}
            </option>
          ))}
        </select>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950" role="dialog" aria-modal="true" aria-labelledby="mapa-titulo">
      <header className="border-b border-neutral-800 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 id="mapa-titulo" className="text-base font-semibold text-neutral-100">
              Organizar o curso
            </h1>
            <p className="truncate text-sm text-neutral-400">
              {curso.title} · divida em módulos e submódulos, arraste, renomeie e escolha a descrição de cada aula. O &quot;Baixar&quot;
              segue esta estrutura.
            </p>
          </div>
          <button type="button" className={botao} disabled={salvando} onClick={() => (mexeu && !confirm('Sair sem salvar o que você organizou?') ? null : fechar())}>
            {primeiraVez ? 'Agora não' : 'Cancelar'}
          </button>
          <button
            type="button"
            disabled={salvando}
            onClick={() => void salvar()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </header>

      <div className="border-b border-neutral-800 bg-neutral-900/60 px-4 py-2 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <form
            className="flex min-w-[16rem] flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              criarModulo();
            }}
          >
            <TextField
              ref={campoNovo}
              value={novoModulo}
              onChange={(e) => setNovoModulo(e.target.value)}
              placeholder={marcadas.size ? `Novo módulo com as ${marcadas.size} marcadas` : 'Nome do novo módulo'}
              aria-label="Nome do novo módulo"
              className="h-9 py-1"
            />
            <button type="submit" className="shrink-0 rounded-lg bg-neutral-800 px-3 text-sm text-neutral-100 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              Criar módulo
            </button>
          </form>
          {marcadas.size > 0 && (
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <span>
                {marcadas.size} marcada{marcadas.size === 1 ? '' : 's'}
              </span>
              <select value="" onChange={(e) => moverMarcadas(e.target.value)} aria-label="Mover as marcadas para" className={seletor}>
                <option value="">Mover para…</option>
                {grupos.map((x) => (
                  <option key={x.chave} value={x.chave}>
                    {x.nome === null ? 'Fora dos módulos' : x.parte.trim() ? comoCaminho(x.nome) : '(sem nome)'}
                  </option>
                ))}
              </select>
              <button type="button" className={botaoPequeno} onClick={() => setMarcadas(new Set())}>
                Desmarcar
              </button>
            </div>
          )}
        </div>
        {erro && (
          <p role="alert" className="mx-auto mt-2 max-w-5xl text-sm text-amber-200">
            {erro}
          </p>
        )}
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {grupos.map((g) => {
            if (g.nome === null && !g.aulas.length && modulos.length) {
              // Sem aulas fora dos módulos: só o lugar para soltar, discreto.
              return (
                <div
                  key={g.chave}
                  {...soltarAqui(g.chave, null)}
                  className={`rounded-lg border border-dashed px-3 py-2 text-xs text-neutral-500 ${
                    alvo?.grupo === g.chave ? 'border-blue-500 text-neutral-300' : 'border-neutral-800'
                  } ${arrastando ? '' : 'hidden'}`}
                >
                  Solte aqui para tirar dos módulos
                </div>
              );
            }
            const vazio = !g.aulas.length;
            const nivel = g.nome === null ? 0 : nivelDe(grupos, g);
            const temFilho = g.nome !== null && grupos.some((x) => x.pai === g.chave);
            return (
              <section key={g.chave} aria-label={g.nome === null ? 'Fora dos módulos' : comoCaminho(g.nome)} className={RECUO[Math.max(0, nivel - 1)]}>
                <div {...soltarAqui(g.chave, null)} className="mb-1.5 flex items-center gap-2">
                  {g.nome === null ? (
                    <h2 className="flex-1 px-1 text-sm font-semibold text-neutral-400">{modulos.length ? 'Fora dos módulos' : 'Aulas'}</h2>
                  ) : (
                    <>
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-neutral-500">{numeroDoModulo.get(g.chave)}</span>
                      <input
                        id={`modulo-${g.chave}`}
                        value={g.parte}
                        onChange={(e) => renomearModulo(g.chave, e.target.value)}
                        aria-label={nivel > 1 ? 'Nome do submódulo' : 'Nome do módulo'}
                        className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-neutral-100 outline-none hover:border-neutral-700 focus:border-neutral-700 focus:bg-neutral-800 focus:ring-2 focus:ring-blue-600"
                      />
                      <span className="shrink-0 text-xs text-neutral-500">
                        {g.aulas.length} aula{g.aulas.length === 1 ? '' : 's'}
                      </span>
                      {nivel < MAX_NIVEIS && (
                        <button
                          type="button"
                          className={botaoPequeno}
                          onClick={() => criarSubmodulo(g.chave)}
                          title="Criar um submódulo dentro deste"
                        >
                          + Submódulo
                        </button>
                      )}
                      <button
                        type="button"
                        className={botaoPequeno}
                        disabled={!irmaoAo(grupos, g, -1)}
                        onClick={() => moverModulo(g.chave, -1)}
                        aria-label="Subir o módulo"
                        title="Subir"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={botaoPequeno}
                        disabled={!irmaoAo(grupos, g, 1)}
                        onClick={() => moverModulo(g.chave, 1)}
                        aria-label="Descer o módulo"
                        title="Descer"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={botaoPequeno}
                        onClick={() => removerModulo(g.chave)}
                        aria-label={`Desfazer o módulo ${comoCaminho(g.nome)}`}
                        title={
                          nivel > 1
                            ? `Desfazer o módulo (as aulas${temFilho ? ' e os submódulos' : ''} vão para o módulo de cima)`
                            : `Desfazer o módulo (as aulas vão para fora dos módulos${temFilho ? ' e os submódulos sobem um nível' : ''})`
                        }
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                <ul className="space-y-1">
                  {g.aulas.map((a) => linha(g, a))}
                  <li
                    {...soltarAqui(g.chave, null)}
                    className={`rounded-lg border border-dashed px-3 text-xs text-neutral-500 ${
                      alvo?.grupo === g.chave && alvo.antes === null ? 'border-blue-500 text-neutral-300' : 'border-neutral-800'
                    } ${vazio ? 'py-4 text-center' : arrastando ? 'py-2' : 'hidden'}`}
                  >
                    {vazio ? 'Arraste aulas para cá, ou marque algumas e use "Mover para…"' : 'Soltar no fim'}
                  </li>
                </ul>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
