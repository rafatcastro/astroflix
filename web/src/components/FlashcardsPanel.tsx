import { Link } from 'react-router-dom';
import { useFlashcards, useMudarFlashcards } from '../api/hooks';
import { AvisoAnki, CartaoFlashcard, FormFlashcard } from './Flashcards';

// Painel dos flashcards da aula, no mesmo lugar da lista de aulas (um fecha o
// outro). O vídeo continua protagonista: o painel só existe quando a pessoa pede.
// O card novo guarda o minuto em que foi escrito, e focar no formulário pausa o
// vídeo, porque ninguém escreve um card com a aula correndo.
export default function FlashcardsPanel({
  lessonId,
  courseId,
  open,
  onClose,
  tempoAtual,
  onIrPara,
  onPausar,
}: {
  lessonId: string;
  courseId: string;
  open: boolean;
  onClose: () => void;
  tempoAtual: () => number;
  onIrPara: (seg: number) => void;
  onPausar: () => void;
}) {
  const { data, isLoading } = useFlashcards({ lessonId }, open);
  const { criar } = useMudarFlashcards();
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-10 bg-black/60 sm:hidden" onClick={onClose} />
      <aside
        aria-label="Flashcards da aula"
        className="absolute right-0 top-0 z-20 flex h-screen w-full max-w-sm flex-col border-l border-neutral-800 bg-neutral-950/95 sm:w-80"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 p-3">
          <span className="text-sm font-medium">Flashcards da aula</span>
          <button type="button" onClick={onClose} aria-label="Fechar (Esc)" className="grid h-11 w-11 shrink-0 place-items-center text-neutral-400">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <FormFlashcard
            rotulo="Adicionar card"
            ocupado={criar.isPending}
            onFocar={onPausar}
            onSalvar={(c) => criar.mutateAsync({ ...c, lessonId, minutoSec: tempoAtual() })}
          />
          <p className="text-xs text-neutral-500">O card guarda o minuto do vídeo em que foi salvo.</p>
          <AvisoAnki anki={data?.anki} pendentes={data?.pendentes ?? 0} />
          {isLoading ? (
            <p className="text-sm text-neutral-500">Carregando…</p>
          ) : data && data.cards.length > 0 ? (
            <ul className="space-y-2">
              {data.cards.map((c) => (
                <CartaoFlashcard key={c.id} card={c} onIrPara={onIrPara} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">Nenhum card desta aula ainda. O que você escrever aqui vai para o Anki.</p>
          )}
        </div>
        <div className="border-t border-neutral-800 p-3 text-xs">
          <Link to={`/flashcards?curso=${courseId}`} className="text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline">
            Todos os flashcards do curso
          </Link>
        </div>
      </aside>
    </>
  );
}
