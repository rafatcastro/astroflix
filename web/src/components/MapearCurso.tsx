import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { CourseDetail, MapaModulo, MaterialDTO } from '../api/client';
import { DESCRICAO, descricoesDasAulas } from '../lib/arvore';
import TextField from './TextField';

// O mapeamento do curso: abre sozinho depois de importar (Drive, Telegram ou uma
// pasta) e pelo menu ⋯ ("Organizar módulos e aulas"). A pessoa divide as aulas em
// módulos, arrasta (ou marca várias e move de uma vez), renomeia e liga um arquivo
// como a descrição da aula, que então sai da lista do curso. Nada disso mexe na
// pasta de origem: fica no app, e o "Baixar" segue a mesma estrutura
// (routes/mapa.ts).

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
  /** null = fora dos módulos (vem antes de todos). */
  nome: string | null;
  aulas: Aula[];
}

let proximaChave = 0;
const novaChave = () => `g${++proximaChave}`;

function gruposIniciais(curso: CourseDetail): Grupo[] {
  const aulas = curso.modules.flatMap((m) => m.lessons);
  const adivinhadas = descricoesDasAulas(aulas, curso.materials);
  const grupos: Grupo[] = [{ chave: novaChave(), nome: null, aulas: [] }];
  for (const l of aulas) {
    // Sem mapeamento ainda, o módulo é a pasta (o que o scan derivou).
    const nome = l.module ?? null;
    let g = grupos.find((x) => x.nome === nome);
    if (!g) grupos.push((g = { chave: novaChave(), nome, aulas: [] }));
    g.aulas.push({
      id: l.id,
      titulo: l.title,
      relPath: l.relPath,
      descricao: typeof l.descricao === 'string' ? l.descricao : (adivinhadas.get(l.id)?.relPath ?? ''),
      missing: l.missing,
    });
  }
  return grupos;
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
    const nome = novoModulo.replace(/\s+/g, ' ').trim();
    if (!nome) return campoNovo.current?.focus();
    if (grupos.some((g) => g.nome?.toLowerCase() === nome.toLowerCase())) return setErro(`Já existe um módulo "${nome}".`);
    setErro(null);
    const chave = novaChave();
    mudar((gs) => [...gs, { chave, nome, aulas: [] }]);
    setNovoModulo('');
    // Com aulas marcadas, o módulo novo já nasce com elas.
    if (marcadas.size) {
      const ids = [...marcadas];
      setTimeout(() => mover(ids, chave, null));
      setMarcadas(new Set());
    }
  };

  const renomearModulo = (chave: string, nome: string) => mudar((gs) => gs.map((g) => (g.chave === chave ? { ...g, nome } : g)));
  const removerModulo = (chave: string) =>
    mudar((gs) => {
      const g = gs.find((x) => x.chave === chave);
      if (!g) return gs;
      return gs.filter((x) => x.chave !== chave).map((x) => (x.nome === null ? { ...x, aulas: [...x.aulas, ...g.aulas] } : x));
    });
  const moverModulo = (chave: string, delta: -1 | 1) =>
    mudar((gs) => {
      const i = gs.findIndex((g) => g.chave === chave);
      const j = i + delta;
      // O grupo "fora dos módulos" fica sempre em cima.
      if (i < 1 || j < 1 || j >= gs.length) return gs;
      const novo = [...gs];
      [novo[i], novo[j]] = [novo[j], novo[i]];
      return novo;
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

  const salvar = async () => {
    const nomes = modulos.map((g) => (g.nome ?? '').trim());
    if (nomes.some((n) => !n)) return setErro('Dê um nome a todos os módulos.');
    if (new Set(nomes.map((n) => n.toLowerCase())).size !== nomes.length) return setErro('Dois módulos têm o mesmo nome.');
    setErro(null);
    setSalvando(true);
    try {
      // Módulo vazio não é salvo: sem aula, não teria pasta nem lugar na lista.
      await onSalvar(
        grupos
          .filter((g) => g.aulas.length)
          .map((g) => ({
            nome: g.nome === null ? null : g.nome.trim(),
            aulas: g.aulas.map((a) => ({ id: a.id, titulo: a.titulo, descricao: a.descricao })),
          })),
      );
    } catch {
      setErro('Não foi possível salvar. Tente de novo.');
      setSalvando(false);
    }
  };

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
              {x.nome === null ? 'Fora dos módulos' : x.nome || '(sem nome)'}
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
              {curso.title} · divida em módulos, arraste, renomeie e escolha a descrição de cada aula. A pasta de origem não muda
              {curso.source === 'local' ? '' : '; o "Baixar" segue esta estrutura'}.
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
                    {x.nome === null ? 'Fora dos módulos' : x.nome || '(sem nome)'}
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
          {grupos.map((g, i) => {
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
            return (
              <section key={g.chave} aria-label={g.nome ?? 'Fora dos módulos'}>
                <div {...soltarAqui(g.chave, null)} className="mb-1.5 flex items-center gap-2">
                  {g.nome === null ? (
                    <h2 className="flex-1 px-1 text-sm font-semibold text-neutral-400">{modulos.length ? 'Fora dos módulos' : 'Aulas'}</h2>
                  ) : (
                    <>
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-neutral-500">{i}</span>
                      <input
                        value={g.nome}
                        onChange={(e) => renomearModulo(g.chave, e.target.value)}
                        aria-label="Nome do módulo"
                        className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-neutral-100 outline-none hover:border-neutral-700 focus:border-neutral-700 focus:bg-neutral-800 focus:ring-2 focus:ring-blue-600"
                      />
                      <span className="shrink-0 text-xs text-neutral-500">
                        {g.aulas.length} aula{g.aulas.length === 1 ? '' : 's'}
                      </span>
                      <button type="button" className={botaoPequeno} disabled={i <= 1} onClick={() => moverModulo(g.chave, -1)} aria-label="Subir o módulo" title="Subir">
                        ↑
                      </button>
                      <button
                        type="button"
                        className={botaoPequeno}
                        disabled={i >= grupos.length - 1}
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
                        aria-label={`Desfazer o módulo ${g.nome}`}
                        title="Desfazer o módulo (as aulas vão para fora dos módulos)"
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
