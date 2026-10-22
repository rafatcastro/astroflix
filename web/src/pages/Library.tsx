import { useMemo, useState, type ReactNode } from 'react';
import { escolherPasta } from '../lib/desktop';
import CabecalhoCategoria, { SEM } from '../components/CabecalhoCategoria';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCollections, useConexaoDrive, useCourseRoots, useCourses } from '../api/hooks';
import { formatDuration, percent } from '../lib/format';
import CourseCardMenu from '../components/CourseCardMenu';
import DriveLinkModal from '../components/DriveLinkModal';
import SeletorDrive from '../components/SeletorDrive';
import MenuAdicionar from '../components/MenuAdicionar';
import TelegramLinkModal from '../components/TelegramLinkModal';
import ConfirmDialog from '../components/ConfirmDialog';
import TextField from '../components/TextField';
import { api, type BatchImportResult, type Collection, type CourseRoot, type CourseSummary } from '../api/client';
import FfmpegBanner from '../components/FfmpegBanner';
import Banner from '../components/Banner';
import { Check, Play, Settings as SettingsIcon } from '../components/icons';

// Parede de capas responsiva sem cliffs de breakpoint: as colunas se ajustam ao
// espaço, mantendo o tamanho do card constante (auto-fill).
const GRID_COLS = { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' } as const;
// Grade com destaque "bento" — o card em destaque ocupa 2×2.
const BENTO_COLS = { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' } as const;

// Mesmo valor na barra e no texto, para um não contradizer o outro. Só chega a
// 100% quando todas as aulas estão concluídas: tempo assistido quase total
// ainda deixa aula sem o "concluir".
function progressoDoCurso(c: CourseSummary): number {
  const porAulas = percent(c.completedLessons, c.totalLessons);
  if (c.progressoReal == null) return porAulas;
  return porAulas === 100 ? 100 : Math.min(c.progressoReal, 99);
}

// "Aula X · parou em 12:34", só no destaque "Continuar".
function paradaEm(c: CourseSummary): string | null {
  const u = c.ultimaAula;
  return u ? `${u.titulo} · parou em ${formatDuration(u.posicaoSec)}` : null;
}

// Card-pôster da estante: a capa é o card; título/progresso vivem sobre o scrim.
function CourseCard({
  c,
  featured = false,
  eyebrow = false,
  archived = false,
  onUnarchive,
  menu,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  c: CourseSummary;
  featured?: boolean;
  eyebrow?: boolean;
  archived?: boolean;
  onUnarchive?: (id: string) => void;
  menu?: ReactNode;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const pct = progressoDoCurso(c);
  const parada = eyebrow ? paradaEm(c) : null;
  return (
    <Link
      to={parada && !selectable ? `/lesson/${c.ultimaAula!.id}` : `/course/${c.id}`}
      aria-pressed={selectable ? selected : undefined}
      onClick={selectable ? (e) => { e.preventDefault(); onToggleSelect?.(c.id); } : undefined}
      className={`group relative block aspect-video overflow-hidden rounded-xl bg-neutral-900 outline-none transition-shadow motion-reduce:transition-none hover:ring-2 hover:ring-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600${featured ? ' sm:col-span-2 sm:row-span-2' : ''}${selected ? ' ring-2 ring-blue-600' : ''}`}
    >
      <div className="absolute inset-0 grid place-items-center bg-neutral-900 text-neutral-700">
        <Play size={featured ? 48 : 32} />
      </div>
      <img
        src={api.courseCoverUrl(c.id)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.03] group-hover:brightness-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      {/* Canto superior: seleção (esquerda) e menu ⋯ (direita), sobre a capa. */}
      {selectable && (
        <span
          aria-hidden
          className={`absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full border-2 ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-white/70 bg-black/40 text-transparent'}`}
        >
          <Check size={16} />
        </span>
      )}
      {!selectable && menu && <span className="absolute right-2 top-2">{menu}</span>}
      {/* Scrim funcional: garante legibilidade do título/progresso sobre a capa.
          pointer-events-none: em cards baixos ele sobe até o topo e roubaria o
          clique do ⋯ — só o botão Desarquivar reativa os eventos. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent pb-2.5 pt-10">
        <div className="px-3">
          {eyebrow && <div className="text-xs uppercase tracking-wide text-blue-400">Continuar</div>}
          <div className={`truncate font-medium text-neutral-50${featured ? ' sm:text-lg' : ''}`}>{c.title}</div>
          {parada && <div className="mt-0.5 truncate text-xs text-neutral-200">{parada}</div>}
          {/* Barra só quando há progresso (Regra da Barra Honesta). */}
          {pct > 0 && (
            <div className="mt-2 h-1 rounded-full bg-white/15">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mt-1.5 text-xs text-neutral-300">
            {pct === 100 ? <span className="text-green-400">✓ Concluído</span> : `${c.completedLessons}/${c.totalLessons} aulas · ${pct}%`}
          </div>
          {archived && onUnarchive && !selectable && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onUnarchive(c.id); }}
              className="pointer-events-auto mt-2 min-h-[44px] rounded-lg bg-white/10 px-3 py-2 text-xs text-neutral-100 backdrop-blur-sm transition-colors hover:bg-white/20 motion-reduce:transition-none"
            >
              Desarquivar
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

// Linha compacta da visão em LISTA: capa pequena + título (inteiro) + progresso,
// com o mesmo menu ⋯ / seleção / desarquivar do card. Título não trunca.
function CourseRow({
  c,
  eyebrow = false,
  archived = false,
  onUnarchive,
  menu,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  c: CourseSummary;
  eyebrow?: boolean;
  archived?: boolean;
  onUnarchive?: (id: string) => void;
  menu?: ReactNode;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const pct = progressoDoCurso(c);
  const parada = eyebrow ? paradaEm(c) : null;
  return (
    <Link
      to={parada && !selectable ? `/lesson/${c.ultimaAula!.id}` : `/course/${c.id}`}
      aria-pressed={selectable ? selected : undefined}
      onClick={selectable ? (e) => { e.preventDefault(); onToggleSelect?.(c.id); } : undefined}
      className={`group flex items-center gap-3 rounded-xl bg-neutral-900 p-2.5 pr-3 outline-none transition-shadow motion-reduce:transition-none hover:ring-2 hover:ring-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600${selected ? ' ring-2 ring-blue-600' : ''}`}
    >
      {selectable && (
        <span
          aria-hidden
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-neutral-600 text-transparent'}`}
        >
          <Check size={16} />
        </span>
      )}
      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-800 sm:w-28">
        <div className="absolute inset-0 grid place-items-center text-neutral-700">
          <Play size={20} />
        </div>
        <img
          src={api.courseCoverUrl(c.id)}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="text-xs uppercase tracking-wide text-blue-400">Continuar</div>}
        <div className="break-words font-medium text-neutral-50">{c.title}</div>
        {parada && <div className="mt-0.5 break-words text-xs text-neutral-300">{parada}</div>}
        <div className="mt-1 text-xs text-neutral-400">
          {pct === 100 ? <span className="text-green-400">✓ Concluído</span> : `${c.completedLessons}/${c.totalLessons} aulas · ${pct}%`}
        </div>
        {pct > 0 && pct < 100 && (
          <div className="mt-1.5 h-1 max-w-xs rounded-full bg-white/10">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {archived && onUnarchive && !selectable && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onUnarchive(c.id); }}
          className="min-h-[44px] shrink-0 rounded-lg bg-neutral-800 px-3 text-xs text-neutral-100 hover:bg-neutral-700"
        >
          Desarquivar
        </button>
      )}
      {!selectable && menu && <span className="shrink-0">{menu}</span>}
    </Link>
  );
}

// Menu ⋯ do cabeçalho de coleção: renomear / excluir (cursos permanecem).
function CollectionHeaderMenu({ col, onNotice }: { col: Collection; onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(col.name);
  const [confirming, setConfirming] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['collections'] });
    qc.invalidateQueries({ queryKey: ['courses'] });
  };
  const doRename = async () => {
    if (!name.trim()) return;
    try {
      await api.renameCollection(col.id, name.trim());
      refresh();
    } catch {
      onNotice('Falha ao renomear a coleção. Tente novamente.');
    }
    setRenaming(false);
  };
  const doDelete = async () => {
    try {
      await api.deleteCollection(col.id);
      refresh();
      onNotice('Coleção excluída — os cursos permanecem na biblioteca.');
    } catch {
      onNotice('Falha ao excluir a coleção. Tente novamente.');
    }
    setConfirming(false);
  };
  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-neutral-800';
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Ações da coleção ${col.name}`}
        className="grid h-11 w-11 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1">
            <button type="button" className={item} onClick={() => { setOpen(false); setName(col.name); setRenaming(true); }}>
              Renomear…
            </button>
            <button type="button" className={`${item} text-red-400`} onClick={() => { setOpen(false); setConfirming(true); }}>
              Excluir…
            </button>
          </div>
        </>
      )}
      {renaming && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setRenaming(false)}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-medium">Renomear coleção</div>
            <TextField
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doRename()}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={() => setRenaming(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={!name.trim()}
                onClick={doRename}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Excluir a coleção "${col.name}"?`}
          message="Só a coleção some — os cursos e o progresso permanecem na biblioteca."
          confirmLabel="Excluir"
          danger
          onConfirm={doDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// Erro de importação em linguagem de gente: o servidor devolve o motivo real
// ('forbidden' | 'invalid_path') e cada um tem uma saída diferente. Uma mensagem
// genérica para os dois deixa o usuário sem saber o que corrigir.
function batchErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'forbidden') {
    return 'Essa pasta está fora das pastas-raiz permitidas. Libere o caminho em Configurações → "Pastas-raiz permitidas" e tente de novo.';
  }
  if (msg === 'invalid_path') {
    return 'Não deu para ler essa pasta — ela pode ter sido movida, renomeada ou estar sem permissão de leitura.';
  }
  return 'Falha ao importar. Verifique a pasta e tente novamente.';
}

// Resultado da importação POR NOME. Só a contagem ("0 importados") não explica
// nada a quem esperava cursos novos: aqui cada pasta aparece no grupo que diz o
// que aconteceu com ela — e o caso "nenhuma subpasta" ganha a saída certa.
function BatchResultPanel({ path, result, onClose }: { path: string; result: BatchImportResult; onClose: () => void }) {
  const folder = path.split('/').filter(Boolean).pop() ?? path;
  const nothingAtAll = result.created === 0 && result.skipped === 0 && result.noVideos === 0;
  const group = (title: string, tone: string, names: string[]) =>
    names.length === 0 ? null : (
      <div key={title}>
        <div className={`mb-1.5 text-sm font-medium ${tone}`}>
          {names.length} {title}
        </div>
        <ul className="space-y-1 text-sm text-neutral-400">
          {names.map((n) => (
            <li key={n} className="break-words">{n}</li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-medium">Importação — {folder}</div>
        <p className="mb-4 break-words text-sm text-neutral-500">{path}</p>

        {nothingAtAll ? (
          <div className="rounded-lg bg-neutral-950 p-4 text-sm text-neutral-400">
            <p className="mb-2 text-neutral-200">Essa pasta não tem nenhuma subpasta.</p>
            <p>
              A importação em lote transforma <span className="text-neutral-300">cada subpasta</span> num curso. Se os
              vídeos estão soltos direto aqui dentro, use <span className="text-neutral-300">Adicionar → Curso</span> e
              aponte para esta mesma pasta.
            </p>
          </div>
        ) : (
          <div className="mb-4 max-h-[55dvh] flex-1 space-y-4 overflow-auto rounded-lg bg-neutral-950 p-4">
            {group('adicionado(s) à biblioteca', 'text-green-400', result.courses.map((c) => c.title))}
            {group('já estava(m) na biblioteca', 'text-neutral-300', result.skippedTitles)}
            {group('sem nenhum vídeo — nada a importar', 'text-amber-300', result.noVideosTitles)}
            {/* Arquivos que a pasta listou mas o sistema não entregou. Comum em
                disco de rede. Contar é obrigatório: pular calado faria a pessoa
                procurar para sempre uma aula que o app decidiu não mencionar. */}
            {result.unreadable > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium text-amber-300">
                  {result.unreadable} arquivo{result.unreadable === 1 ? '' : 's'} não pôde ser lido
                </div>
                <p className="mb-2 text-sm text-neutral-400">
                  A pasta os lista, mas o sistema de arquivos não os entregou. Costuma acontecer em disco de rede
                  instável — tente de novo mais tarde, ou use "Re-escanear agora" no menu do curso.
                </p>
                <ul className="space-y-1 text-sm text-neutral-500">
                  {result.unreadableSample.map((n) => (
                    <li key={n} className="break-words">{n}</li>
                  ))}
                  {result.unreadable > result.unreadableSample.length && (
                    <li className="text-neutral-600">e mais {result.unreadable - result.unreadableSample.length}…</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// Pastas de cursos: lembra a raiz da importação em lote e permite reescanear só
// as subpastas novas (cursos novos) sem reabrir o seletor de pastas. Só aparece
// com ao menos uma raiz registrada — o registro é automático, feito pelo próprio
// POST /api/courses/batch a cada execução.
function CourseRootsSection({
  onNotice,
  onResult,
}: {
  onNotice: (m: string) => void;
  onResult: (path: string, result: BatchImportResult) => void;
}) {
  const qc = useQueryClient();
  const { data: roots } = useCourseRoots();
  const [checking, setChecking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const check = async (r: CourseRoot) => {
    setChecking(r.id);
    try {
      const res = await api.batchImport(r.path);
      onResult(r.path, res);
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: ['courseRoots'] });
    } catch (e) {
      onNotice(batchErrorMessage(e));
    }
    setChecking(null);
  };

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await api.deleteCourseRoot(id);
      qc.invalidateQueries({ queryKey: ['courseRoots'] });
    } catch {
      onNotice('Não foi possível esquecer essa pasta agora.');
    }
    setRemoving(null);
  };

  if (!roots || roots.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">Pastas de cursos</h2>
      <div className="space-y-2">
        {roots.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-neutral-900 p-4">
            <div className="min-w-0 flex-1 break-words text-sm text-neutral-300">{r.path}</div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                disabled={checking === r.id}
                onClick={() => void check(r)}
                className="min-h-[44px] rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
              >
                {checking === r.id ? 'Verificando…' : 'Verificar novos cursos'}
              </button>
              <button
                type="button"
                aria-label={`Esquecer pasta ${r.path}`}
                disabled={removing === r.id}
                onClick={() => void remove(r.id)}
                className="grid h-11 w-11 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// A aba Cursos de uma categoria (`categoria` = id ou 'sem').
export default function Library({ categoria }: { categoria: string }) {
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  // Grade (pôsteres) ou lista (linhas compactas): escolhida em Configurações → Aparência.
  const [view] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('libView') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const { data: todos, isLoading, isError } = useCourses(tab === 'archived');
  const courses = useMemo(
    () => todos?.filter((c) => (categoria === SEM ? !c.collectionId : c.collectionId === categoria)),
    [todos, categoria],
  );
  const { data: collections } = useCollections();
  const [picking, setPicking] = useState<null | 'drive' | 'drive-link' | 'telegram'>(null);
  // Pasta com vídeo só nas subpastas: um curso com módulos ou uma estante de cursos?
  const [ambigua, setAmbigua] = useState<{ path: string; subpastas: number } | null>(null);
  // Sem o app do Telegram no build nem um próprio nas Configurações, a opção só
  // levaria a um "não configurado": melhor não oferecer.
  const { data: tg } = useQuery({ queryKey: ['telegramStatus'], queryFn: api.telegramStatus });
  const temTelegram = Boolean(tg?.credenciais.apiId && tg?.credenciais.apiHash);
  const [creatingCol, setCreatingCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [filter, setFilter] = useState<'all' | 'none' | string>('all');
  const [notice, setNotice] = useState<string | null>(null);
  // Resultado da última importação em lote (do seletor ou do "Verificar novos
  // cursos") — mostrado em painel, com os nomes das pastas.
  const [batchResult, setBatchResult] = useState<{ path: string; result: BatchImportResult } | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['courses'] });
  const unarchive = async (id: string) => { await api.patchCourse(id, { archived: false }); refresh(); };

  // Modo seleção: cards alternam em vez de navegar; ações em lote na barra fixa.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAssign, setBatchAssign] = useState(false);
  const [batchColName, setBatchColName] = useState('');
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
    setBatchAssign(false);
  };

  // Em série de propósito (SQLite local responde em ms); falhas não abortam o lote.
  const doBatchAssign = async (collectionId: string | null) => {
    setBatchAssign(false);
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      try { await api.patchCourse(id, { collectionId }); ok += 1; } catch { fail += 1; }
    }
    qc.invalidateQueries({ queryKey: ['courses'] });
    qc.invalidateQueries({ queryKey: ['collections'] });
    setNotice(`${collectionId ? 'Movidos para a categoria' : 'Tirados da categoria'}: ${ok} curso${ok === 1 ? '' : 's'}${fail ? ` · ${fail} falhou` : ''}.`);
    exitSelect();
  };
  const doBatchCreateAssign = async () => {
    if (!batchColName.trim()) return;
    try {
      const col = await api.createCollection(batchColName.trim());
      await doBatchAssign(col.id);
    } catch {
      setNotice('Falha ao criar a categoria. Tente novamente.');
    }
  };
  const doBatchArchive = async () => {
    const toArchived = tab === 'active';
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      try { await api.patchCourse(id, { archived: toArchived }); ok += 1; } catch { fail += 1; }
    }
    refresh();
    setNotice(`${ok} curso${ok === 1 ? '' : 's'} ${toArchived ? 'arquivado' : 'desarquivado'}${ok === 1 ? '' : 's'}${fail ? ` · ${fail} falhou` : ''}.`);
    exitSelect();
  };

  // Props compartilhadas dos cards: em modo seleção alternam; fora dele, o menu ⋯
  // (só em Ativos — em Arquivados o card já tem o botão Desarquivar).
  const cardProps = (c: CourseSummary) =>
    selectMode
      ? { selectable: true, selected: selected.has(c.id), onToggleSelect: toggleSelect }
      : { menu: tab === 'active' ? <CourseCardMenu course={c} onNotice={setNotice} /> : undefined };

  // O destaque é o ÚLTIMO CURSO ACESSADO (lastActivityAt mais recente); o resto
  // mantém a ordem do servidor. Sem atividade nenhuma, nada se move. Só em Ativos.
  const ordered = useMemo(() => {
    if (!courses || tab !== 'active') return courses;
    let idx = -1;
    for (let i = 0; i < courses.length; i++) {
      const at = courses[i].lastActivityAt;
      if (at && (idx === -1 || at > (courses[idx].lastActivityAt ?? ''))) idx = i;
    }
    if (idx <= 0) return courses;
    return [courses[idx], ...courses.slice(0, idx), ...courses.slice(idx + 1)];
  }, [courses, tab]);
  const hasActivity = tab === 'active' && !!ordered?.[0]?.lastActivityAt;

  // Dentro de uma categoria não há agrupamento: as antigas coleções são as próprias categorias.
  const hasCollections = false;
  const uncollected = useMemo(() => (ordered ?? []).filter((c) => !c.collectionId), [ordered]);
  const visible = useMemo(() => {
    const list = ordered ?? [];
    if (!hasCollections || filter === 'all') return list;
    if (filter === 'none') return list.filter((c) => !c.collectionId);
    return list.filter((c) => c.collectionId === filter);
  }, [ordered, hasCollections, filter]);

  const doCreateCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await api.createCollection(newColName.trim());
      qc.invalidateQueries({ queryKey: ['collections'] });
      setNotice('Coleção criada. Use o menu ⋯ de um curso para adicioná-lo a ela.');
    } catch {
      setNotice('Falha ao criar a categoria. Tente novamente.');
    }
    setCreatingCol(false);
  };

  // Adicionar um curso: idempotente. Se a pasta já é um curso, o servidor
  // re-escaneia (sem duplicar) e devolve existing=true.
  const doAddCourse = async (path: string) => {
    setNotice('Adicionando curso…');
    try {
      const r = await api.createCourse(path);
      // Adicionado dentro de uma categoria: entra nela.
      if (categoria !== SEM && !r.existing) await api.patchCourse(r.id, { collectionId: categoria });
      refresh();
      setNotice(r.existing ? 'Essa pasta já era um curso — re-escaneei (arquivos novos incluídos, sem duplicar).' : 'Curso adicionado.');
    } catch {
      setNotice('Não foi possível adicionar o curso. Verifique a pasta e tente novamente.');
    }
  };

  const doBatchImport = async (path: string) => {
    setPicking(null);
    setNotice('Importando cursos…');
    try {
      const r = await api.batchImport(path);
      if (categoria !== SEM) for (const c of r.courses) await api.patchCourse(c.id, { collectionId: categoria }).catch(() => undefined);
      setNotice(null);
      setBatchResult({ path, result: r });
      refresh();
      qc.invalidateQueries({ queryKey: ['courseRoots'] });
    } catch (e) {
      setNotice(batchErrorMessage(e));
    }
  };

  // Uma entrada só para pastas do disco: o seletor nativo devolve um caminho e o
  // servidor diz o que tem dentro. Antes eram duas ("Curso" e "Pasta de cursos")
  // e a pessoa tinha de saber de antemão qual das duas era a dela.
  const adicionarDosArquivos = async () => {
    let path: string | null;
    try {
      path = await escolherPasta('Escolha a pasta do curso (ou a pasta com vários cursos)');
    } catch {
      setNotice('Não foi possível abrir o seletor de pastas.');
      return;
    }
    if (!path) return;
    try {
      const info = await api.inspect(path);
      if (info.videosNaRaiz || info.subpastasComVideo === 1) void doAddCourse(path);
      else if (info.subpastasComVideo === 0) setNotice('Não achei vídeos nessa pasta.');
      else setAmbigua({ path, subpastas: info.subpastasComVideo });
    } catch (e) {
      setNotice(batchErrorMessage(e));
    }
  };

  const drive = useConexaoDrive();
  // Mesmo botão e mesmo menu da aba PDFs (MenuAdicionar), com as origens de curso.
  const addMenuButton = (
    <MenuAdicionar
      opcoes={[
        { rotulo: 'Dos arquivos…', descricao: 'Uma pasta com um curso ou com vários', onClick: () => void adicionarDosArquivos() },
        drive.conectado === false
          ? {
              rotulo: drive.conectando ? 'Esperando o Google…' : 'Conectar o Google Drive',
              descricao: 'Para trazer cursos do seu Drive',
              onClick: () => void drive.conectar().then((ok) => ok && setPicking('drive')),
            }
          : { rotulo: 'Do Google Drive', descricao: 'Escolha a pasta do curso no seu Drive', onClick: () => setPicking('drive') },
        ...(temTelegram
          ? [{ rotulo: 'Do Telegram', descricao: 'Cole o link de um grupo, canal ou bot', onClick: () => setPicking('telegram') }]
          : []),
      ]}
    />
  );

  const chip = (active: boolean) =>
    `min-h-[44px] rounded-full px-4 text-sm transition-colors motion-reduce:transition-none ${
      active ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
    }`;

  // Renderiza uma lista de cursos como GRADE (pôsteres, com destaque bento
  // opcional) ou como LISTA (linhas compactas), conforme a preferência.
  const renderCourses = (list: CourseSummary[], opts: { bento?: boolean; withFeatured?: boolean } = {}) => {
    if (view === 'list') {
      return (
        <div className="space-y-2">
          {list.map((c, i) => (
            <CourseRow
              key={c.id}
              c={c}
              eyebrow={!!opts.withFeatured && i === 0 && hasActivity}
              archived={tab === 'archived'}
              onUnarchive={unarchive}
              {...cardProps(c)}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="grid gap-4" style={opts.bento ? BENTO_COLS : GRID_COLS}>
        {list.map((c, i) => (
          <CourseCard
            key={c.id}
            c={c}
            featured={!!opts.withFeatured && i === 0}
            eyebrow={!!opts.withFeatured && i === 0 && hasActivity}
            archived={tab === 'archived'}
            onUnarchive={unarchive}
            {...cardProps(c)}
          />
        ))}
      </div>
    );
  };

  const sectionFor = (title: string, list: CourseSummary[], menu?: React.ReactNode, emptyHint?: string) => (
    <section key={title}>
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="font-medium text-neutral-200">{title}</h2>
        <span className="text-sm text-neutral-500">{list.length}</span>
        {menu}
      </div>
      {list.length > 0 ? (
        renderCourses(list)
      ) : (
        <p className="rounded-xl border border-neutral-800 px-4 py-6 text-sm text-neutral-500">{emptyHint}</p>
      )}
    </section>
  );

  return (
    <div className={`mx-auto max-w-6xl px-6 py-8${selectMode ? ' pb-28' : ''}`}>
      <CabecalhoCategoria
        cat={categoria}
        info={courses && courses.length > 0 ? `${courses.length} curso${courses.length === 1 ? '' : 's'}` : undefined}
        acoes={
          <>
          <div className="inline-flex overflow-hidden rounded-lg border border-neutral-800 text-sm">
            <button
              type="button"
              onClick={() => { setTab('active'); exitSelect(); }}
              className={`min-h-[44px] px-3 py-1.5 ${tab === 'active' ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'}`}
            >
              Ativos
            </button>
            <button
              type="button"
              onClick={() => { setTab('archived'); exitSelect(); }}
              className={`min-h-[44px] px-3 py-1.5 ${tab === 'archived' ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'}`}
            >
              Arquivados
            </button>
          </div>
          {courses && courses.length > 0 && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              className={`min-h-[44px] shrink-0 rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none ${selectMode ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'}`}
            >
              {selectMode ? 'Cancelar' : 'Selecionar'}
            </button>
          )}
          <Link
            to="/settings"
            aria-label="Configurações"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          >
            <SettingsIcon size={18} />
          </Link>
          {tab === 'active' && addMenuButton}
          </>
        }
      />

      <FfmpegBanner />
      {notice && (
        <div className="mb-4">
          <Banner tone="info">{notice}</Banner>
        </div>
      )}
      {tab === 'active' && (
        <CourseRootsSection onNotice={setNotice} onResult={(path, result) => setBatchResult({ path, result })} />
      )}

      {/* Chips de coleção: filtram a estante; "Todas" mostra as seções. */}
      {hasCollections && !isLoading && !isError && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button type="button" className={chip(filter === 'all')} onClick={() => setFilter('all')}>
            Todas
          </button>
          {(collections ?? []).map((col) => (
            <button key={col.id} type="button" className={chip(filter === col.id)} onClick={() => setFilter(col.id)}>
              {col.name} · {col.courseCount}
            </button>
          ))}
          {uncollected.length > 0 && (
            <button type="button" className={chip(filter === 'none')} onClick={() => setFilter('none')}>
              Sem coleção · {uncollected.length}
            </button>
          )}
        </div>
      )}

      {isLoading && (
        <div className="grid gap-4" style={GRID_COLS} aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-xl bg-neutral-900 motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="grid place-items-center rounded-xl border border-neutral-800 py-16 text-center">
          <div className="max-w-xs px-6">
            <Banner tone="warn">Não foi possível carregar seus cursos. Verifique a conexão e recarregue.</Banner>
          </div>
        </div>
      )}

      {!isLoading && !isError && courses?.length === 0 && (
        <div className="grid place-items-center rounded-xl border border-neutral-800 py-16 text-center">
          <div className="max-w-xs px-6">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-neutral-900 text-neutral-600">
              <Play size={24} />
            </div>
            <div className="mb-1 font-medium text-neutral-200">
              {tab === 'archived' ? 'Nenhum curso arquivado' : 'Nenhum curso ainda'}
            </div>
            <p className="mb-5 text-sm text-neutral-500">
              {tab === 'archived'
                ? 'Cursos arquivados aparecem aqui.'
                : 'Use Adicionar, no topo, para trazer uma pasta do disco, do Google Drive ou do Telegram.'}
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && courses && courses.length > 0 && (
        tab === 'archived' || !hasCollections ? (
          // Sem coleções (ou aba Arquivados): a estante única de sempre, com destaque.
          renderCourses(ordered ?? courses, { bento: true, withFeatured: tab === 'active' })
        ) : filter !== 'all' ? (
          // Filtro por chip: parede única da coleção escolhida.
          visible.length > 0 ? (
            renderCourses(visible)
          ) : (
            <p className="rounded-xl border border-neutral-800 px-4 py-6 text-sm text-neutral-500">
              Nenhum curso nesta coleção ainda. Use o menu ⋯ de um curso para adicioná-lo.
            </p>
          )
        ) : (
          // "Todas" com coleções: Continuar em destaque + uma seção por coleção.
          <div className="space-y-10">
            {hasActivity && ordered && renderCourses([ordered[0]], { bento: true, withFeatured: true })}
            {(collections ?? []).map((col) =>
              sectionFor(
                col.name,
                (ordered ?? []).filter((c) => c.collectionId === col.id),
                <CollectionHeaderMenu col={col} onNotice={setNotice} />,
                'Nenhum curso nesta coleção ainda. Use o menu ⋯ de um curso para adicioná-lo.',
              ),
            )}
            {uncollected.length > 0 && sectionFor('Sem coleção', uncollected)}
          </div>
        )
      )}

      {/* Barra de ações em lote: fixa embaixo enquanto o modo seleção está ativo. */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
            <span className="text-sm text-neutral-300">
              {selected.size === 0 ? 'Toque nos cursos para selecionar' : `${selected.size} selecionado${selected.size === 1 ? '' : 's'}`}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => { setBatchColName(''); setBatchAssign(true); }}
                className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Mover para categoria…
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => void doBatchArchive()}
                className="min-h-[44px] rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
              >
                {tab === 'active' ? 'Arquivar' : 'Desarquivar'}
              </button>
              <button type="button" onClick={exitSelect} className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {batchAssign && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setBatchAssign(false)}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-medium">
              Mover {selected.size} curso{selected.size === 1 ? '' : 's'} para a categoria
            </div>
            {(collections ?? []).length === 0 && (
              <p className="mb-3 text-sm text-neutral-500">Nenhuma categoria ainda — crie a primeira abaixo.</p>
            )}
            {(collections ?? []).length > 0 && (
              <div className="mb-3 max-h-56 space-y-1 overflow-y-auto">
                {(collections ?? []).map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => void doBatchAssign(col.id)}
                    className="flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-800"
                  >
                    <span className="truncate">{col.name}</span>
                  </button>
                ))}
              </div>
            )}
            {(collections ?? []).length > 0 && (
              <button
                type="button"
                onClick={() => void doBatchAssign(null)}
                className="mb-3 min-h-[44px] w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                Tirar da categoria
              </button>
            )}
            <div className="flex gap-2">
              <TextField
                value={batchColName}
                onChange={(e) => setBatchColName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doBatchCreateAssign()}
                placeholder="Nova categoria"
              />
              <button
                type="button"
                onClick={() => void doBatchCreateAssign()}
                disabled={!batchColName.trim()}
                className="min-h-[44px] shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {picking === 'drive' && (
        <SeletorDrive
          modo="curso"
          categoriaId={categoria === SEM ? undefined : categoria}
          onClose={() => setPicking(null)}
          onColarLink={() => setPicking('drive-link')}
        />
      )}
      {picking === 'drive-link' && <DriveLinkModal categoriaId={categoria === SEM ? undefined : categoria} onClose={() => setPicking(null)} />}
      {picking === 'telegram' && <TelegramLinkModal categoriaId={categoria === SEM ? undefined : categoria} onClose={() => setPicking(null)} />}
      {ambigua && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setAmbigua(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="ambigua-titulo" className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div id="ambigua-titulo" className="mb-1 font-medium">O que tem nessa pasta?</div>
            <p className="mb-4 text-sm text-neutral-400">Os vídeos estão em {ambigua.subpastas} subpastas.</p>
            <div className="grid gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => { const p = ambigua.path; setAmbigua(null); void doBatchImport(p); }}
                className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-left text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Vários cursos
                <div className="text-xs text-blue-100">Cada subpasta vira um curso</div>
              </button>
              <button
                type="button"
                onClick={() => { const p = ambigua.path; setAmbigua(null); void doAddCourse(p); }}
                className="min-h-[44px] rounded-lg bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Um curso só
                <div className="text-xs text-neutral-400">As subpastas viram os módulos</div>
              </button>
              <button
                type="button"
                onClick={() => setAmbigua(null)}
                className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {batchResult && (
        <BatchResultPanel path={batchResult.path} result={batchResult.result} onClose={() => setBatchResult(null)} />
      )}

      {creatingCol && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setCreatingCol(false)}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-medium">Nova coleção</div>
            <TextField
              autoFocus
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doCreateCollection()}
              placeholder="Nome da coleção"
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={() => setCreatingCol(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={!newColName.trim()}
                onClick={doCreateCollection}
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
