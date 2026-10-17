import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { caminhoDaCategoria } from './CabecalhoCategoria';
import { api, type CourseDetail, type RepointSummary } from '../api/client';
import { useCollections } from '../api/hooks';
import DirPicker from './DirPicker';
import RepointModal from './RepointModal';
import ConfirmDialog from './ConfirmDialog';
import TextField from './TextField';

type Flow = null | 'menu' | 'pickRepoint' | 'preview' | 'rename' | 'collection' | 'confirmArchive' | 'confirmReset' | 'confirmDelete';

export default function CourseMenu({
  course,
  onEditCover,
  onNotice,
  onBaixar,
  baixando,
}: {
  course: CourseDetail;
  onEditCover: () => void;
  onNotice: (text: string) => void;
  /** Baixar o curso inteiro para Downloads; só vem para cursos do Drive e do Telegram. */
  onBaixar?: () => void;
  /** Este curso está sendo baixado agora (o painel de downloads mostra o progresso). */
  baixando?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [flow, setFlow] = useState<Flow>(null);
  const [pickedPath, setPickedPath] = useState('');
  const [summary, setSummary] = useState<RepointSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [newColName, setNewColName] = useState('');
  const { data: collections } = useCollections();

  const close = () => setFlow(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['course', course.id] });
    qc.invalidateQueries({ queryKey: ['courses'] });
    qc.invalidateQueries({ queryKey: ['collections'] });
  };

  // Categoria é organização: atribuir/remover nunca mexe em progresso.
  const assignCollection = async (collectionId: string | null) => {
    try {
      await api.patchCourse(course.id, { collectionId });
      invalidate();
      onNotice(collectionId ? 'Curso movido para a categoria.' : 'Curso tirado da categoria.');
    } catch {
      onNotice('Falha na operação. Tente novamente.');
    }
    close();
  };

  const createAndAssign = async () => {
    if (!newColName.trim()) return;
    try {
      const col = await api.createCollection(newColName.trim());
      await api.patchCourse(course.id, { collectionId: col.id });
      invalidate();
      onNotice(`Curso movido para a nova categoria "${col.name}".`);
    } catch {
      onNotice('Falha na operação. Tente novamente.');
    }
    close();
  };

  const onPickRepoint = async (p: string) => {
    setPickedPath(p);
    try {
      const res = await api.repointPreview(course.id, p);
      if ('status' in res) {
        onNotice('Pasta indisponível.');
        close();
        return;
      }
      setSummary(res);
      setFlow('preview');
    } catch {
      onNotice('Falha na operação. Tente novamente.');
      close();
    }
  };

  const applyRepoint = async () => {
    setBusy(true);
    try {
      const res = await api.repoint(course.id, pickedPath);
      setBusy(false);
      close();
      if ('status' in res) return onNotice('Pasta indisponível — nada mudou.');
      invalidate();
      onNotice('Curso re-apontado: progresso preservado.');
    } catch {
      setBusy(false);
      close();
      onNotice('Falha na operação. Tente novamente.');
    }
  };

  const doRescan = async () => {
    close();
    try {
      const res = await api.rescan(course.id);
      if ('status' in res) return onNotice('Pasta indisponível — se ela mudou de lugar, re-aponte pelo menu.');
      invalidate();
      onNotice(res.added || res.missing || res.relinked ? `Atualizado: +${res.added} novas, ${res.missing} faltando.` : 'Nada mudou.');
    } catch (e) {
      onNotice(e instanceof Error && e.message === 'carregando'
        ? 'A pasta ainda está sendo lida. Espere terminar e tente de novo.'
        : 'Falha na operação. Tente novamente.');
    }
  };

  const doResetProgress = async () => {
    close();
    try {
      const r = await api.resetCourseProgress(course.id);
      invalidate();
      onNotice(`Progresso zerado (${r.deleted} aula${r.deleted === 1 ? '' : 's'}).`);
    } catch {
      onNotice('Falha ao zerar o progresso. Tente novamente.');
    }
  };

  const doRename = async () => {
    if (title.trim() === '') return;
    try {
      await api.patchCourse(course.id, { title: title.trim() });
      close();
      invalidate();
      onNotice('Curso renomeado.');
    } catch {
      close();
      onNotice('Falha na operação. Tente novamente.');
    }
  };

  const doArchive = async () => {
    try {
      await api.patchCourse(course.id, { archived: true });
      invalidate();
      navigate(caminhoDaCategoria(course.collectionId));
    } catch {
      close();
      onNotice('Falha na operação. Tente novamente.');
    }
  };

  const doDelete = async () => {
    try {
      await api.deleteCourse(course.id);
      invalidate();
      navigate(caminhoDaCategoria(course.collectionId));
    } catch {
      close();
      onNotice('Falha na operação. Tente novamente.');
    }
  };

  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-neutral-800';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setFlow(flow === 'menu' ? null : 'menu')}
        aria-label="Ações do curso"
        className="grid h-11 w-11 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        ⋯
      </button>

      {flow === 'menu' && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1">
            {/* Curso do Drive: capa é automática (o servidor recusa com 409) e não há pasta local para re-apontar. */}
            {course.source === 'local' && <button className={item} onClick={() => { close(); onEditCover(); }}>Editar capa</button>}
            {course.source === 'local' && <button className={item} onClick={() => setFlow('pickRepoint')}>Re-apontar pasta…</button>}
            {onBaixar && (
              <button className={`${item} disabled:text-neutral-500`} disabled={baixando} onClick={() => { close(); onBaixar(); }}>
                {baixando ? 'Baixando para Downloads…' : 'Baixar para Downloads…'}
              </button>
            )}
            <button className={item} onClick={doRescan}>Re-escanear agora</button>
            <button className={item} onClick={() => { setTitle(course.title); setFlow('rename'); }}>Renomear…</button>
            <button className={item} onClick={() => { setNewColName(''); setFlow('collection'); }}>Mover para categoria…</button>
            <button className={item} onClick={() => setFlow('confirmReset')}>Zerar progresso…</button>
            <button className={item} onClick={() => setFlow('confirmArchive')}>Arquivar</button>
            <button className={`${item} text-red-400`} onClick={() => setFlow('confirmDelete')}>Excluir…</button>
          </div>
        </>
      )}

      {flow === 'pickRepoint' && <DirPicker onClose={close} onPick={onPickRepoint} />}

      {flow === 'preview' && summary && (
        <RepointModal courseTitle={course.title} targetPath={pickedPath} summary={summary} busy={busy} onApply={applyRepoint} onCancel={close} />
      )}

      {flow === 'rename' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-medium">Renomear curso</div>
            <TextField
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doRename()}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <button className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={close}>Cancelar</button>
              <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40" disabled={!title.trim()} onClick={doRename}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {flow === 'collection' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-medium">Categoria</div>
            {(collections ?? []).length === 0 && (
              <p className="mb-3 text-sm text-neutral-500">Nenhuma categoria ainda — crie a primeira abaixo.</p>
            )}
            {(collections ?? []).length > 0 && (
              <div className="mb-3 max-h-56 space-y-1 overflow-y-auto">
                {(collections ?? []).map((col) => {
                  const current = course.collectionId === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => void assignCollection(col.id)}
                      className={`flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${current ? 'bg-blue-600/20 text-blue-300' : 'hover:bg-neutral-800'}`}
                    >
                      <span className="truncate">{col.name}</span>
                      {current && <span aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {course.collectionId && (
              <button
                type="button"
                onClick={() => void assignCollection(null)}
                className="mb-3 min-h-[44px] w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                Tirar da categoria
              </button>
            )}
            <div className="flex gap-2">
              <TextField
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createAndAssign()}
                placeholder="Nova categoria"
              />
              <button
                type="button"
                onClick={createAndAssign}
                disabled={!newColName.trim()}
                className="min-h-[44px] shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {flow === 'confirmReset' && (
        <ConfirmDialog
          title={`Zerar o progresso de "${course.title}"?`}
          message="Posições e aulas concluídas deste curso voltam a zero. As aulas, a capa e a categoria permanecem. Não dá para desfazer."
          confirmLabel="Zerar progresso"
          danger
          onConfirm={doResetProgress}
          onCancel={close}
        />
      )}

      {flow === 'confirmArchive' && (
        <ConfirmDialog
          title="Arquivar curso?"
          message="Some da Biblioteca (aba Arquivados). O progresso é mantido e você pode desarquivar depois."
          confirmLabel="Arquivar"
          onConfirm={doArchive}
          onCancel={close}
        />
      )}

      {flow === 'confirmDelete' && (
        <ConfirmDialog
          title={`Excluir "${course.title}"?`}
          message="Remove o curso e todo o progresso definitivamente. Os arquivos de vídeo no disco não são tocados."
          confirmLabel="Excluir"
          danger
          onConfirm={doDelete}
          onCancel={close}
        />
      )}
    </div>
  );
}
