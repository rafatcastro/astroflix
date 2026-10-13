import { Link } from 'react-router-dom';
import { useFlashcards, useMudarFlashcards } from '../api/hooks';
import { AvisoAnki, CartaoFlashcard, FormFlashcard } from './Flashcards';

// Aba de flashcards da aula, ao lado do vídeo. O card novo guarda o minuto em que
// foi escrito, e focar no formulário pausa o vídeo, porque ninguém escreve um card
// com a aula correndo.
export default function FlashcardsPanel({
  lessonId,
  courseId,
  tempoAtual,
  onIrPara,
  onPausar,
}: {
  lessonId: string;
  courseId: string;
  tempoAtual: () => number;
  onIrPara: (seg: number) => void;
  onPausar: () => void;
}) {
  const { data, isLoading } = useFlashcards({ lessonId });
  const { criar } = useMudarFlashcards();

  return (
    <div className="space-y-3 p-3">
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
      <Link
        to={`/flashcards?curso=${courseId}`}
        className="inline-block text-xs text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline"
      >
        Todos os flashcards do curso
      </Link>
    </div>
  );
}
