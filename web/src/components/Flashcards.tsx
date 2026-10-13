import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { EstadoAnki, Flashcard } from '../api/client';
import { useMudarFlashcards } from '../api/hooks';

// Peças dos flashcards usadas no painel da aula e na tela Flashcards. O card mora
// no Anki; aqui ele é escrito, mostrado e ligado à aula. Por isso todo lugar que
// lista cards diz também em que pé está a conversa com o Anki.

export function formatarMinuto(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const AREA =
  'w-full resize-y rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600';
const BOTAO_PRIMARIO =
  'min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40';
const BOTAO_TEXTO =
  'min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/** O que a pessoa precisa saber sobre o Anki. Nada quando está tudo certo. */
export function AvisoAnki({ anki, pendentes }: { anki: EstadoAnki | undefined; pendentes: number }) {
  if (!anki || (anki === 'conectado' && pendentes === 0)) return null;
  const quantos = pendentes === 1 ? '1 card espera' : `${pendentes} cards esperam`;
  const texto =
    anki === 'fechado'
      ? `Anki fechado. ${pendentes ? `${quantos} para ir quando você abrir o Anki.` : 'Abra o Anki para os cards irem para lá.'}`
      : anki === 'erro'
        ? `O Anki recusou um card. ${pendentes ? `${quantos} para ir.` : ''}`
        : `${quantos} para ir ao Anki.`;
  return (
    <p role="status" className="rounded-lg border border-amber-700/40 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
      {texto}{' '}
      {anki === 'fechado' && (
        <Link to="/settings#anki" className="underline hover:no-underline">
          Como conectar
        </Link>
      )}
    </p>
  );
}

/** Frente e verso. ⌘/Ctrl+Enter salva, Esc cancela. */
export function FormFlashcard({
  inicial,
  rotulo,
  onSalvar,
  onCancelar,
  onFocar,
  ocupado,
}: {
  inicial?: { frente: string; verso: string };
  rotulo: string;
  onSalvar: (c: { frente: string; verso: string }) => Promise<unknown>;
  onCancelar?: () => void;
  onFocar?: () => void;
  ocupado?: boolean;
}) {
  const [frente, setFrente] = useState(inicial?.frente ?? '');
  const [verso, setVerso] = useState(inicial?.verso ?? '');
  const frenteRef = useRef<HTMLTextAreaElement>(null);
  const pronto = frente.trim() !== '' && verso.trim() !== '' && !ocupado;

  const salvar = async () => {
    if (!pronto) return;
    await onSalvar({ frente: frente.trim(), verso: verso.trim() });
    if (!inicial) {
      setFrente('');
      setVerso('');
      // Próximo card já com o cursor na frente: quem anota costuma fazer vários.
      frenteRef.current?.focus();
    }
  };
  const teclas = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void salvar();
    } else if (e.key === 'Escape' && onCancelar) {
      e.preventDefault();
      e.stopPropagation();
      onCancelar();
    }
  };

  return (
    <div className="space-y-2" onKeyDown={teclas}>
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-400">Frente</span>
        <textarea ref={frenteRef} rows={2} value={frente} onChange={(e) => setFrente(e.target.value)} onFocus={onFocar} className={AREA} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-neutral-400">Verso</span>
        <textarea rows={3} value={verso} onChange={(e) => setVerso(e.target.value)} onFocus={onFocar} className={AREA} />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void salvar()} disabled={!pronto} className={BOTAO_PRIMARIO}>
          {rotulo}
        </button>
        {onCancelar && (
          <button type="button" onClick={onCancelar} className={BOTAO_TEXTO}>
            Cancelar
          </button>
        )}
        <span className="ml-auto hidden text-xs text-neutral-500 sm:inline">⌘/Ctrl + Enter</span>
      </div>
    </div>
  );
}

/**
 * Um card: a frente sempre, o verso só ao pedir (é um flashcard, afinal).
 * `onIrPara` existe no painel da aula: o minuto vira link para o vídeo.
 */
export function CartaoFlashcard({
  card,
  onIrPara,
  mostrarOrigem,
}: {
  card: Flashcard;
  onIrPara?: (seg: number) => void;
  mostrarOrigem?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const { editar, apagar } = useMudarFlashcards();

  if (editando) {
    return (
      <li className="rounded-lg bg-neutral-900 p-3">
        <FormFlashcard
          inicial={card}
          rotulo="Salvar"
          ocupado={editar.isPending}
          onSalvar={(c) => editar.mutateAsync({ id: card.id, ...c }).then(() => setEditando(false))}
          onCancelar={() => setEditando(false)}
        />
      </li>
    );
  }

  return (
    <li className="rounded-lg bg-neutral-900 p-3 text-sm">
      <div className="flex items-start gap-2">
        {card.minutoSec != null && card.lessonId && onIrPara ? (
          <button
            type="button"
            onClick={() => onIrPara(card.minutoSec!)}
            title="Ir para este momento da aula"
            className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-blue-300 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {formatarMinuto(card.minutoSec)}
          </button>
        ) : null}
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-neutral-100">{card.frente}</p>
      </div>
      {aberto ? (
        <p className="mt-2 whitespace-pre-wrap break-words border-t border-neutral-800 pt-2 text-neutral-300">{card.verso}</p>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="mt-1 min-h-[32px] text-xs text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Mostrar verso
        </button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        {mostrarOrigem && card.lessonTitle && (
          <span className="min-w-0 truncate">
            {card.lessonTitle}
            {card.minutoSec != null ? ` · ${formatarMinuto(card.minutoSec)}` : ''}
          </span>
        )}
        {!card.noAnki && <span className="text-amber-300/80">Aguardando o Anki</span>}
        <span className="ml-auto flex gap-1">
          {confirmando ? (
            <>
              <button type="button" onClick={() => apagar.mutate(card.id)} className="min-h-[32px] px-2 text-red-400 hover:text-red-300">
                Apagar também no Anki
              </button>
              <button type="button" onClick={() => setConfirmando(false)} className="min-h-[32px] px-2 hover:text-neutral-200">
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditando(true)} className="min-h-[32px] px-2 hover:text-neutral-200">
                Editar
              </button>
              <button type="button" onClick={() => setConfirmando(true)} className="min-h-[32px] px-2 hover:text-red-400">
                Apagar
              </button>
            </>
          )}
        </span>
      </div>
    </li>
  );
}
