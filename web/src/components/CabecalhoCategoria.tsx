import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCollections, useCourses, useDownloads } from '../api/hooks';
import ConfirmDialog from './ConfirmDialog';
import DialogoCategoria from './DialogoCategoria';
import { ArrowLeft, Download, Pencil } from './icons';

// Dentro de uma categoria: o nome dela e as três abas (Cursos, PDFs, Questões).
// `cat` é o id da categoria ou 'sem' (o que ainda não tem categoria).

export const SEM = 'sem';
const CHAVE_ULTIMA = 'categoriaAtual';

/** A categoria em que a pessoa estava: o "voltar" do curso e do leitor leva para ela. */
export function ultimaCategoria(): string {
  try {
    return localStorage.getItem(CHAVE_ULTIMA) || SEM;
  } catch {
    return SEM;
  }
}

export function caminhoDaCategoria(cat: string | null | undefined, aba: '' | 'pdfs' | 'questoes' = ''): string {
  return `/c/${cat || SEM}${aba ? `/${aba}` : ''}`;
}

export function useNomeCategoria(cat: string): string | null {
  const { data } = useCollections();
  if (cat === SEM) return 'Sem categoria';
  return data?.find((c) => c.id === cat)?.name ?? null;
}

function useEmojiCategoria(cat: string): string | null {
  const { data } = useCollections();
  return data?.find((c) => c.id === cat)?.emoji ?? null;
}

export default function CabecalhoCategoria({ cat, acoes, info }: { cat: string; acoes?: ReactNode; info?: ReactNode }) {
  const nome = useNomeCategoria(cat);
  const emoji = useEmojiCategoria(cat);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [editando, setEditando] = useState(false);
  const [confirmandoBaixar, setConfirmandoBaixar] = useState(false);

  // "Baixar" a categoria: os cursos do Drive e do Telegram dela vão para
  // Downloads, cada um na sua pasta (o mesmo "Baixar para Downloads" do curso).
  const { data: cursos } = useCourses();
  const remotos = (cursos ?? []).filter((c) => c.source !== 'local' && (c.collectionId ?? SEM) === cat);
  // O progresso fica no painel de downloads (em toda tela).
  const { data: downloads } = useDownloads();
  const baixando = remotos.some((c) => downloads?.itens.some((e) => e.courseId === c.id && e.ativo));
  const baixar = () => {
    setConfirmandoBaixar(false);
    void api.exportarCategoria(cat).then(() => qc.invalidateQueries({ queryKey: ['downloads'] }), () => undefined);
  };

  // Editar "Sem categoria" a transforma numa categoria de verdade, levando tudo o
  // que estava sem (cursos, PDFs, questões gerais); a tela segue nela, na mesma aba.
  async function salvar(c: { name: string; emoji: string | null }) {
    if (cat === SEM) {
      const nova = await api.createCollection(c.name, c.emoji, true);
      setEditando(false);
      void qc.invalidateQueries();
      navigate(pathname.replace(`/c/${SEM}`, `/c/${nova.id}`), { replace: true });
      return;
    }
    await api.editarCategoria(cat, c);
    setEditando(false);
    void qc.invalidateQueries({ queryKey: ['collections'] });
    void qc.invalidateQueries({ queryKey: ['flashcards'] });
  }

  // Entrou: ela vai para o começo do menu principal (a última aberta primeiro).
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_ULTIMA, cat);
    } catch {
      /* modo privado */
    }
    if (cat !== SEM) void api.acessarCategoria(cat).then(() => qc.invalidateQueries({ queryKey: ['collections'] }), () => undefined);
  }, [cat, qc]);

  const aba = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-[44px] items-center border-b-2 px-1 text-sm font-medium outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
      isActive ? 'border-blue-500 text-neutral-50' : 'border-transparent text-neutral-400 hover:text-neutral-200'
    }`;

  return (
    <header className="mb-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded text-sm text-neutral-400 transition-colors hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <ArrowLeft size={16} /> Categorias
      </Link>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {emoji && (
                <span className="mr-2" aria-hidden>
                  {emoji}
                </span>
              )}
              {nome ?? '\u00a0'}
            </h1>
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label={cat === SEM ? 'Dar um nome a esta categoria' : 'Editar categoria'}
              title={cat === SEM ? 'Dar um nome' : 'Editar categoria'}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <Pencil size={16} />
            </button>
          </div>
          {info && <div className="mt-1 text-sm text-neutral-500">{info}</div>}
        </div>
        {(acoes || remotos.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {remotos.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmandoBaixar(true)}
                disabled={baixando}
                title="Baixar os cursos do Drive e do Telegram desta categoria para a pasta Downloads"
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-default disabled:text-neutral-500"
              >
                <Download size={16} /> {baixando ? 'Baixando…' : 'Baixar'}
              </button>
            )}
            {acoes}
          </div>
        )}
      </div>
      <nav aria-label="Conteúdo da categoria" className="mt-4 flex gap-6 border-b border-neutral-800">
        <NavLink to={caminhoDaCategoria(cat)} end className={aba}>
          Cursos
        </NavLink>
        <NavLink to={caminhoDaCategoria(cat, 'pdfs')} className={aba}>
          PDFs
        </NavLink>
        <NavLink to={caminhoDaCategoria(cat, 'questoes')} className={aba}>
          Questões
        </NavLink>
      </nav>
      {confirmandoBaixar && (
        <ConfirmDialog
          title="Baixar a categoria"
          message={
            <>
              {remotos.length === 1 ? 'O curso' : `Os ${remotos.length} cursos`} do Drive e do Telegram desta categoria vão para a pasta
              Downloads, cada um na sua pasta, com os nomes originais. O que já estiver lá não é baixado de novo. Cursos de pastas do
              computador ficam de fora: eles já estão no disco.
            </>
          }
          confirmLabel="Baixar"
          onConfirm={baixar}
          onCancel={() => setConfirmandoBaixar(false)}
        />
      )}
      {editando && (
        <DialogoCategoria
          inicial={cat === SEM ? undefined : { name: nome ?? '', emoji }}
          aviso={cat === SEM ? 'Tudo o que está sem categoria (cursos, PDFs e questões) vai para ela.' : undefined}
          onSalvar={salvar}
          onCancelar={() => setEditando(false)}
        />
      )}
    </header>
  );
}
