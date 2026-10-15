import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Collection } from '../api/client';
import { useCollections, useCourses } from '../api/hooks';
import { caminhoDaCategoria, SEM } from '../components/CabecalhoCategoria';
import ConfirmDialog from '../components/ConfirmDialog';
import HelpLink from '../components/HelpLink';
import { Download, HelpCircle, Plus, Settings as SettingsIcon } from '../components/icons';
import { cliqueFora } from '../lib/desktop';

// O menu principal: as categorias (Pós, Concurso, Inglês…), a última aberta
// primeiro. Cada uma junta cursos, PDFs e questões. O que ainda não tem
// categoria aparece em "Sem categoria", para nada sumir.

const campo =
  'min-h-[44px] w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600';

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
  const [nome, setNome] = useState('');
  const [editando, setEditando] = useState<Collection | null>(null);
  const [excluindo, setExcluindo] = useState<Collection | null>(null);

  const semCursos = cursos?.filter((c) => !c.collectionId).length ?? 0;
  const semPdfs = docs?.filter((d) => !d.categoriaId).length ?? 0;
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['collections'] });
    void qc.invalidateQueries({ queryKey: ['courses'] });
    void qc.invalidateQueries({ queryKey: ['documentos'] });
  };

  async function criar() {
    if (!nome.trim()) return;
    const c = await api.createCollection(nome.trim());
    setCriando(false);
    setNome('');
    atualizar();
    navigate(caminhoDaCategoria(c.id));
  }

  async function renomear() {
    if (!editando || !nome.trim()) return;
    await api.renameCollection(editando.id, nome.trim());
    setEditando(null);
    atualizar();
  }

  const icone = 'grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800';

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
          <p className="mt-1 text-sm text-neutral-500">Cursos, PDFs e questões de cada assunto</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpLink className="no-underline">
            <span aria-label="Ajuda" title="Ajuda (?)" className={icone}>
              <HelpCircle size={18} />
            </span>
          </HelpLink>
          {/* Backup à mão: exportar é hábito, e hábito escondido em Configurações não pega. */}
          <a
            href={api.exportLibraryUrl}
            onClick={(e) => cliqueFora(e, api.exportLibraryUrl)}
            aria-label="Exportar biblioteca"
            title="Exportar biblioteca (backup)"
            className={icone}
          >
            <Download size={18} />
          </a>
          <Link to="/settings" aria-label="Configurações" className={icone}>
            <SettingsIcon size={18} />
          </Link>
          <button
            type="button"
            onClick={() => {
              setNome('');
              setCriando(true);
            }}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Plus size={18} /> Nova categoria
          </button>
        </div>
      </header>

      {isLoading && <p className="text-sm text-neutral-500">Carregando…</p>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {(cats ?? []).map((c, i) => (
          <div key={c.id} className="group relative">
            <Link
              to={caminhoDaCategoria(c.id)}
              className="flex h-full min-h-[120px] flex-col justify-end rounded-xl bg-neutral-900 p-4 outline-none transition-shadow hover:ring-2 hover:ring-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none"
            >
              {i === 0 && c.acessadoEm && <div className="mb-1 text-xs uppercase tracking-wide text-blue-400">Última aberta</div>}
              <div className="truncate pr-10 text-lg font-medium text-neutral-50">{c.name}</div>
              <div className="mt-1 text-sm text-neutral-400">{contagem(c.courseCount, c.pdfCount)}</div>
            </Link>
            <div className="absolute right-2 top-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setNome(c.name);
                  setEditando(c);
                }}
                className="min-h-[36px] rounded-lg bg-black/40 px-2 text-xs text-neutral-300 hover:bg-black/60 hover:text-white"
              >
                Renomear
              </button>
              <button
                type="button"
                onClick={() => setExcluindo(c)}
                className="min-h-[36px] rounded-lg bg-black/40 px-2 text-xs text-neutral-300 hover:bg-black/60 hover:text-red-300"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
        {(semCursos > 0 || semPdfs > 0) && (
          <Link
            to={caminhoDaCategoria(SEM)}
            className="flex min-h-[120px] flex-col justify-end rounded-xl border border-dashed border-neutral-800 p-4 outline-none hover:border-neutral-600 focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <div className="text-lg font-medium text-neutral-300">Sem categoria</div>
            <div className="mt-1 text-sm text-neutral-500">{contagem(semCursos, semPdfs)}</div>
          </Link>
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

      {(criando || editando) && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => (setCriando(false), setEditando(null))}>
          <form
            role="dialog"
            aria-modal="true"
            aria-label={editando ? 'Renomear categoria' : 'Nova categoria'}
            className="w-full max-w-sm rounded-xl bg-neutral-900 p-5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && (setCriando(false), setEditando(null))}
            onSubmit={(e) => {
              e.preventDefault();
              void (editando ? renomear() : criar());
            }}
          >
            <h2 className="font-medium text-neutral-100">{editando ? 'Renomear categoria' : 'Nova categoria'}</h2>
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Pós em Engenharia"
              maxLength={80}
              autoComplete="off"
              className={`${campo} mt-3`}
            />
            <p className="mt-2 text-xs text-neutral-500">No Anki, as questões dela ficam em Learnflix::{nome.trim().replace(/::/g, ':') || '…'}.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="min-h-[44px] px-3 text-sm text-neutral-400 hover:text-neutral-200"
                onClick={() => (setCriando(false), setEditando(null))}
              >
                Cancelar
              </button>
              <button type="submit" className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500">
                {editando ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {excluindo && (
        <ConfirmDialog
          title={`Excluir a categoria "${excluindo.name}"?`}
          message="Só a categoria some: os cursos, os PDFs e as questões dela vão para Sem categoria, com o progresso intacto."
          confirmLabel="Excluir"
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
