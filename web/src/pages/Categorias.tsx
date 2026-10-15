import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Collection } from '../api/client';
import { useCollections, useCourses } from '../api/hooks';
import { caminhoDaCategoria, SEM } from '../components/CabecalhoCategoria';
import ConfirmDialog from '../components/ConfirmDialog';
import DialogoCategoria from '../components/DialogoCategoria';
import { EstudoDeHoje, PainelEstudo } from '../components/Pomodoro';
import { Plus, Settings as SettingsIcon } from '../components/icons';

// O menu principal: as categorias (Pós, Concurso, Inglês…), a última aberta
// primeiro. Cada uma junta cursos, PDFs e questões. O que ainda não tem
// categoria aparece em "Sem categoria", para nada sumir.


function contagem(cursos: number, pdfs: number): string {
  const partes = [];
  if (cursos) partes.push(`${cursos} curso${cursos === 1 ? '' : 's'}`);
  if (pdfs) partes.push(`${pdfs} PDF${pdfs === 1 ? '' : 's'}`);
  return partes.join(' · ') || 'Vazia';
}

export default function Categorias() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: cats, isLoading } = useCollections();
  const { data: cursos } = useCourses();
  const { data: docs } = useQuery({ queryKey: ['documentos', 'todos'], queryFn: () => api.listarDocumentos() });
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Collection | null>(null);
  // Menu do botão direito (ou do ⋯, para quem usa o teclado), na posição do clique.
  // `c` nulo é o "Sem categoria": editar dá um nome a ele (vira categoria com tudo o
  // que estava sem) e remover apaga o conteúdo dele, já que não há categoria a excluir.
  const [menu, setMenu] = useState<{ c: Collection | null; x: number; y: number } | null>(null);
  const [excluindo, setExcluindo] = useState<Collection | null>(null);
  const [nomeandoSem, setNomeandoSem] = useState(false);
  const [apagandoSem, setApagandoSem] = useState(false);

  const semCursos = cursos?.filter((c) => !c.collectionId).length ?? 0;
  const semPdfs = docs?.filter((d) => !d.categoriaId).length ?? 0;
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['collections'] });
    void qc.invalidateQueries({ queryKey: ['courses'] });
    void qc.invalidateQueries({ queryKey: ['documentos'] });
  };

  async function criar(c: { name: string; emoji: string | null }) {
    const nova = await api.createCollection(c.name, c.emoji);
    setCriando(false);
    atualizar();
    navigate(caminhoDaCategoria(nova.id));
  }

  async function editar(c: { name: string; emoji: string | null }) {
    if (!editando) return;
    await api.editarCategoria(editando.id, c);
    setEditando(null);
    atualizar();
  }

  async function nomearSem(c: { name: string; emoji: string | null }) {
    const nova = await api.createCollection(c.name, c.emoji, true);
    setNomeandoSem(false);
    atualizar();
    navigate(caminhoDaCategoria(nova.id));
  }

  // Remove do app os cursos e PDFs sem categoria; os arquivos no disco ficam.
  async function apagarSem() {
    const idsCursos = (cursos ?? []).filter((c) => !c.collectionId).map((c) => c.id);
    const idsPdfs = (docs ?? []).filter((d) => !d.categoriaId).map((d) => d.id);
    await Promise.all([...idsCursos.map((id) => api.deleteCourse(id)), ...idsPdfs.map((id) => api.removerDocumento(id))]);
    setApagandoSem(false);
    atualizar();
  }

  const abrirMenu = (c: Collection | null) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ c, x: e.clientX, y: e.clientY });
  };

  const botaoAcoes = (c: Collection | null) => (
    <button
      type="button"
      aria-label={`Ações de ${c?.name ?? 'Sem categoria'}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ c, x: r.left, y: r.bottom + 4 });
      }}
      className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg bg-black/40 text-neutral-300 opacity-100 hover:bg-black/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
    >
      ⋯
    </button>
  );

  const icone = 'grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800';

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
          <p className="mt-1 text-sm text-neutral-500">Cursos, PDFs e questões de cada assunto</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/settings" aria-label="Configurações" className={icone}>
            <SettingsIcon size={18} />
          </Link>
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Plus size={18} /> Nova categoria
          </button>
        </div>
      </header>

      <PainelEstudo />

      {isLoading && <p className="text-sm text-neutral-500">Carregando…</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {(cats ?? []).map((c, i) => (
          <div
            key={c.id}
            className="group relative"
            onContextMenu={abrirMenu(c)}
          >
            <Link
              to={caminhoDaCategoria(c.id)}
              className="flex h-full min-h-[120px] flex-col justify-end rounded-xl bg-neutral-900 p-4 outline-none transition-shadow hover:ring-2 hover:ring-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none"
            >
              {c.emoji && (
                <div className="mb-2 text-3xl leading-none" aria-hidden>
                  {c.emoji}
                </div>
              )}
              {i === 0 && c.acessadoEm && <div className="mb-1 text-xs uppercase tracking-wide text-blue-400">Última aberta</div>}
              <div className="truncate pr-10 text-lg font-medium text-neutral-50">{c.name}</div>
              <div className="mt-1 text-sm text-neutral-400">{contagem(c.courseCount, c.pdfCount)}</div>
              <EstudoDeHoje categoriaId={c.id} />
            </Link>
            {botaoAcoes(c)}
          </div>
        ))}
        {(semCursos > 0 || semPdfs > 0) && (
          <div className="group relative" onContextMenu={abrirMenu(null)}>
            <Link
              to={caminhoDaCategoria(SEM)}
              className="flex h-full min-h-[120px] flex-col justify-end rounded-xl border border-dashed border-neutral-800 p-4 outline-none hover:border-neutral-600 focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <div className="pr-10 text-lg font-medium text-neutral-300">Sem categoria</div>
              <div className="mt-1 text-sm text-neutral-500">{contagem(semCursos, semPdfs)}</div>
              <EstudoDeHoje categoriaId={SEM} />
            </Link>
            {botaoAcoes(null)}
          </div>
        )}
      </div>

      {!isLoading && (cats ?? []).length === 0 && semCursos === 0 && semPdfs === 0 && (
        <div className="mt-4 rounded-xl border border-neutral-800 px-6 py-12 text-center">
          <h2 className="text-lg font-medium text-neutral-200">Comece por uma categoria</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-400">
            Uma pós, um concurso, um idioma. Dentro dela você adiciona os cursos, os PDFs e as questões.
          </p>
        </div>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} />
          <div
            role="menu"
            className="fixed z-40 w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-lg shadow-black/40"
            style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 100) }}
            onKeyDown={(e) => e.key === 'Escape' && setMenu(null)}
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              className="block w-full px-3 py-2.5 text-left text-sm hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              onClick={() => {
                if (menu.c) setEditando(menu.c);
                else setNomeandoSem(true);
                setMenu(null);
              }}
            >
              Editar…
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2.5 text-left text-sm text-red-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              onClick={() => {
                if (menu.c) setExcluindo(menu.c);
                else setApagandoSem(true);
                setMenu(null);
              }}
            >
              Remover…
            </button>
          </div>
        </>
      )}

      {criando && <DialogoCategoria onSalvar={criar} onCancelar={() => setCriando(false)} />}
      {editando && (
        <DialogoCategoria inicial={{ name: editando.name, emoji: editando.emoji }} onSalvar={editar} onCancelar={() => setEditando(null)} />
      )}

      {nomeandoSem && (
        <DialogoCategoria
          aviso="Tudo o que está sem categoria (cursos, PDFs e questões) vai para ela."
          onSalvar={nomearSem}
          onCancelar={() => setNomeandoSem(false)}
        />
      )}

      {apagandoSem && (
        <ConfirmDialog
          title="Remover tudo o que está sem categoria?"
          message={`${contagem(semCursos, semPdfs)} saem do app, com o progresso. Os arquivos no disco ficam.`}
          confirmLabel="Remover"
          danger
          digitar="confirmar"
          onConfirm={() => void apagarSem()}
          onCancel={() => setApagandoSem(false)}
        />
      )}

      {excluindo && (
        <ConfirmDialog
          title={`Remover a categoria "${excluindo.name}"?`}
          message="Só a categoria some: os cursos, os PDFs e as questões dela vão para Sem categoria, com o progresso intacto."
          confirmLabel="Remover"
          danger
          digitar="confirmar"
          onConfirm={async () => {
            await api.deleteCollection(excluindo.id);
            setExcluindo(null);
            atualizar();
          }}
          onCancel={() => setExcluindo(null)}
        />
      )}
    </div>
  );
}
