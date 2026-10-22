import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { caminhoDaCategoria } from './CabecalhoCategoria';
import { api, type RepointSummary } from '../api/client';
import { useCollections, useDownloads } from '../api/hooks';
import { formatBytes } from '../lib/format';
import DirPicker from './DirPicker';
import RepointModal from './RepointModal';
import ConfirmDialog from './ConfirmDialog';
import TextField from './TextField';
import { mensagemErroTelegram } from '../api/telegramTextos';

type Flow =
  | null
  | 'menu'
  | 'pickRepoint'
  | 'preview'
  | 'pickConectar'
  | 'confirmDesconectar'
  | 'rename'
  | 'collection'
  | 'confirmBaixar'
  | 'confirmRemoverBaixados'
  | 'confirmArchive'
  | 'confirmReset'
  | 'confirmDelete';

/** O que o menu precisa do curso; sai igual do cartão da categoria e da página do curso. */
export interface CursoDoMenu {
  id: string;
  title: string;
  source: 'local' | 'drive' | 'telegram';
  collectionId: string | null;
  pastaConectada?: string | null;
  /** Aulas baixadas (cursos do Drive e do Telegram). */
  baixadas?: number;
  primeiraAulaId?: string | null;
  /** O tamanho do curso inteiro, para o "Baixar" dizer quanto vai ocupar (só a página sabe). */
  tamanhoRemoto?: number | null;
}

/**
 * O menu ⋯ de um curso. É o mesmo no cartão da categoria e na página do curso,
 * para as opções não mudarem conforme o lugar. Abre como folha centrada (e não
 * como dropdown): o cartão é overflow-hidden e um dropdown seria cortado; a
 * folha também funciona melhor no touch.
 */
export default function CourseMenu({
  course,
  onNotice,
  noCartao,
}: {
  course: CursoDoMenu;
  onNotice: (text: string) => void;
  /** No cartão o botão fica por cima da capa; arquivar e excluir não saem da tela. */
  noCartao?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: collections } = useCollections();
  const { data: downloads } = useDownloads();
  const [flow, setFlow] = useState<Flow>(null);
  const [pickedPath, setPickedPath] = useState('');
  const [summary, setSummary] = useState<RepointSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [newColName, setNewColName] = useState('');

  const remoto = course.source !== 'local';
  const temBaixadas = (course.baixadas ?? 0) > 0;
  const baixando = !!downloads?.itens.some((e) => e.courseId === course.id && e.ativo);
  // No cartão, a mensagem diz de qual curso se trata; na página, isso é óbvio.
  const doCurso = (texto: string) => (noCartao ? `"${course.title}": ${texto}` : texto);

  const close = () => setFlow(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['course', course.id] });
    qc.invalidateQueries({ queryKey: ['courses'] });
    qc.invalidateQueries({ queryKey: ['collections'] });
  };
  // Arquivar e excluir: na página o curso some, então volta para a categoria.
  const sair = () => {
    if (!noCartao) navigate(caminhoDaCategoria(course.collectionId));
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

  // A pasta da pessoa vira a pasta do curso: o que já está lá conta como baixado.
  const onPickConectar = async (p: string) => {
    close();
    try {
      const r = await api.conectarPasta(course.id, p);
      invalidate();
      onNotice(
        doCurso(
          `pasta conectada. ${r.adotados ? `${r.adotados} arquivo${r.adotados === 1 ? '' : 's'} já estava${r.adotados === 1 ? '' : 'm'} lá` : 'Nenhum arquivo do curso estava lá'}; ${r.baixadas} de ${r.total} aulas disponíveis offline.`,
        ).replace(/^pasta/, 'Pasta'),
      );
    } catch (e) {
      const erro = e instanceof Error ? e.message : '';
      onNotice(
        erro === 'pasta-de-outro-curso'
          ? 'Essa pasta já está conectada a outro curso.'
          : erro === 'forbidden'
            ? 'Essa pasta fica fora das pastas que o app pode ler.'
            : 'Não deu para conectar essa pasta.',
      );
    }
  };

  const desconectar = async () => {
    close();
    try {
      await api.desconectarPasta(course.id);
      invalidate();
      onNotice('Pasta desconectada. Nenhum arquivo foi apagado.');
    } catch {
      onNotice('Falha na operação. Tente novamente.');
    }
  };

  const doRescan = async () => {
    close();
    try {
      const res = await api.rescan(course.id);
      if ('status' in res) return onNotice(doCurso('pasta indisponível — se ela mudou de lugar, re-aponte pelo menu.'));
      invalidate();
      const novas = course.source === 'telegram' ? `+${res.added} novos (vídeos e fotos)` : `+${res.added} novas`;
      onNotice(res.added || res.missing || res.relinked ? doCurso(`atualizado: ${novas}, ${res.missing} faltando.`) : doCurso('nada mudou.'));
    } catch (e) {
      if (course.source === 'telegram' && e instanceof Error) return onNotice(doCurso(mensagemErroTelegram(e.message, (e as { esperaSeg?: number }).esperaSeg)));
      onNotice(
        e instanceof Error && e.message === 'carregando'
          ? 'A pasta ainda está sendo lida. Espere terminar e tente de novo.'
          : 'Falha ao re-escanear. Tente novamente.',
      );
    }
  };

  // O curso inteiro para a pasta do curso (drive/baixar.ts); o progresso aparece no painel de downloads.
  const doBaixar = async () => {
    close();
    try {
      await api.baixarCurso(course.id);
      qc.invalidateQueries({ queryKey: ['downloads'] });
    } catch {
      onNotice('Não deu para começar o download. Tente de novo.');
    }
  };

  // Apaga só o que foi baixado: o curso e o progresso ficam, e as aulas voltam a tocar pela rede.
  const doRemoverBaixados = async () => {
    close();
    try {
      await api.removerBaixados(course.id);
      invalidate();
      qc.invalidateQueries({ queryKey: ['downloads'] });
      qc.invalidateQueries({ queryKey: ['armazenamento'] });
      onNotice('Download removido. As aulas continuam tocando pela internet.');
    } catch {
      onNotice('Não deu para remover o download. Tente de novo.');
    }
  };

  const doRename = async () => {
    if (!title.trim()) return;
    try {
      await api.patchCourse(course.id, { title: title.trim() });
      invalidate();
      onNotice('Curso renomeado.');
    } catch {
      onNotice('Falha ao renomear. Tente novamente.');
    }
    close();
  };

  const doResetProgress = async () => {
    close();
    try {
      const r = await api.resetCourseProgress(course.id);
      invalidate();
      onNotice(doCurso(`progresso zerado (${r.deleted} aula${r.deleted === 1 ? '' : 's'}).`));
    } catch {
      onNotice('Falha ao zerar o progresso. Tente novamente.');
    }
  };

  const doArchive = async () => {
    close();
    try {
      await api.patchCourse(course.id, { archived: true });
      invalidate();
      onNotice(`"${course.title}" arquivado — está na aba Arquivados.`);
      sair();
    } catch {
      onNotice('Falha ao arquivar. Tente novamente.');
    }
  };

  const doDelete = async () => {
    close();
    try {
      await api.deleteCourse(course.id);
      invalidate();
      onNotice(`"${course.title}" excluído.`);
      sair();
    } catch {
      onNotice('Falha ao excluir. Tente novamente.');
    }
  };

  const item = 'block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-neutral-800 disabled:text-neutral-500 disabled:hover:bg-transparent';
  // No cartão o clique não pode chegar ao link da capa.
  const parar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Ações de ${course.title}`}
        onClick={(e) => {
          parar(e);
          setTitle(course.title);
          setFlow('menu');
        }}
        className={
          noCartao
            ? 'grid h-11 w-11 place-items-center rounded-lg bg-black/50 text-neutral-200 backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none'
            : 'grid h-11 w-11 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600'
        }
      >
        ⋯
      </button>

      {flow === 'menu' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={(e) => { parar(e); close(); }}>
          <div className="max-h-[85dvh] w-full max-w-xs overflow-y-auto rounded-xl bg-neutral-900 p-2" onClick={parar}>
            <div className="truncate px-3 pb-2 pt-2 text-sm font-medium text-neutral-200">{course.title}</div>
            {/* Curso do Drive/Telegram: a capa é automática e não há pasta de origem para re-apontar. */}
            {!remoto && course.primeiraAulaId && (
              <button type="button" className={item} onClick={() => { close(); navigate(`/lesson/${course.primeiraAulaId}`); }}>
                Editar capa
              </button>
            )}
            {!remoto && <button type="button" className={item} onClick={() => setFlow('pickRepoint')}>Re-apontar pasta…</button>}
            {remoto && (
              <button type="button" className={item} disabled={baixando} onClick={() => setFlow('confirmBaixar')}>
                {baixando ? 'Baixando…' : 'Baixar…'}
              </button>
            )}
            {remoto && (temBaixadas || course.pastaConectada) && (
              <button
                type="button"
                className={item}
                onClick={() => { close(); void api.abrirArmazenamento(course.id).catch(() => onNotice('Não deu para abrir a pasta.')); }}
              >
                {course.pastaConectada ? 'Abrir pasta conectada' : 'Abrir pasta baixada'}
              </button>
            )}
            {remoto && temBaixadas && !course.pastaConectada && (
              <button type="button" className={item} onClick={() => setFlow('confirmRemoverBaixados')}>Remover download…</button>
            )}
            {remoto && (
              <button type="button" className={item} onClick={() => setFlow('pickConectar')}>
                {course.pastaConectada ? 'Trocar pasta conectada…' : 'Conectar a uma pasta…'}
              </button>
            )}
            {course.pastaConectada && (
              <button type="button" className={item} onClick={() => setFlow('confirmDesconectar')}>Desconectar pasta…</button>
            )}
            <button type="button" className={item} onClick={doRescan}>
              {course.source === 'telegram' ? 'Re-escanear (vídeos e fotos)' : 'Re-escanear'}
            </button>
            <button type="button" className={item} onClick={() => setFlow('rename')}>Renomear…</button>
            <button type="button" className={item} onClick={() => { setNewColName(''); setFlow('collection'); }}>Mover para categoria…</button>
            <button type="button" className={item} onClick={() => setFlow('confirmReset')}>Zerar progresso…</button>
            <button type="button" className={item} onClick={() => setFlow('confirmArchive')}>Arquivar…</button>
            <button type="button" className={`${item} text-red-400`} onClick={() => setFlow('confirmDelete')}>Excluir…</button>
          </div>
        </div>
      )}

      {flow === 'pickRepoint' && <DirPicker onClose={close} onPick={onPickRepoint} />}
      {flow === 'preview' && summary && (
        <RepointModal courseTitle={course.title} targetPath={pickedPath} summary={summary} busy={busy} onApply={applyRepoint} onCancel={close} />
      )}

      {flow === 'pickConectar' && (
        <DirPicker
          title="Escolha a pasta onde está o conteúdo deste curso. O app só acrescenta arquivos nela: nada do que está lá é apagado ou alterado."
          confirmLabel="Conectar esta pasta"
          onClose={close}
          onPick={(p) => void onPickConectar(p)}
        />
      )}
      {flow === 'confirmDesconectar' && (
        <ConfirmDialog
          title="Desconectar a pasta?"
          message={`O curso deixa de usar ${course.pastaConectada ?? 'a pasta'}. Nenhum arquivo é apagado; as aulas voltam a tocar pela internet e os próximos downloads vão para a pasta de armazenamento do app.`}
          confirmLabel="Desconectar"
          onConfirm={() => void desconectar()}
          onCancel={close}
        />
      )}

      {flow === 'rename' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={(e) => { parar(e); close(); }}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={parar}>
            <div className="mb-3 font-medium">Renomear curso</div>
            <TextField
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doRename()}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={close}>
                Cancelar
              </button>
              <button
                type="button"
                className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={!title.trim()}
                onClick={doRename}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {flow === 'collection' && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={(e) => { parar(e); close(); }}>
          <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={parar}>
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

      {flow === 'confirmBaixar' && (
        <ConfirmDialog
          title={`Baixar "${course.title}"`}
          message={
            course.pastaConectada
              ? `Todas as aulas e materiais${course.tamanhoRemoto ? ` (${formatBytes(course.tamanhoRemoto)})` : ''} que ainda não estão na pasta conectada são acrescentados nela, para tocarem sem internet. O que já está lá não é baixado de novo nem alterado.`
              : `Todas as aulas e materiais${course.tamanhoRemoto ? ` (${formatBytes(course.tamanhoRemoto)})` : ''} são adiantados na pasta de downloads (Configurações → Armazenamento), numa pasta com o nome do curso e os nomes originais, para tocarem sem internet. O que já foi baixado não é baixado de novo.`
          }
          confirmLabel="Baixar"
          onConfirm={() => void doBaixar()}
          onCancel={close}
        />
      )}

      {flow === 'confirmRemoverBaixados' && (
        <ConfirmDialog
          title="Remover o download?"
          message={`Apaga as ${course.baixadas ?? 0} aula(s) e os materiais baixados deste curso. O curso e o progresso ficam, e as aulas voltam a tocar pela internet (e a ser baixadas quando você abrir).`}
          confirmLabel="Remover"
          danger
          onConfirm={() => void doRemoverBaixados()}
          onCancel={close}
        />
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
          message="Some da categoria (aba Arquivados). O progresso é mantido e você pode desarquivar depois."
          confirmLabel="Arquivar"
          onConfirm={() => void doArchive()}
          onCancel={close}
        />
      )}

      {flow === 'confirmDelete' && (
        <ConfirmDialog
          title={`Excluir "${course.title}"?`}
          message={
            !remoto
              ? 'Remove o curso e todo o progresso definitivamente. Os arquivos de vídeo no disco não são tocados.'
              : `Remove o curso e todo o progresso definitivamente. O que foi baixado fica na pasta e é aproveitado se você importar o curso de novo. O original no ${course.source === 'drive' ? 'Drive' : 'Telegram'} não é tocado.`
          }
          confirmLabel="Excluir"
          danger
          onConfirm={() => void doDelete()}
          onCancel={close}
        />
      )}
    </>
  );
}
