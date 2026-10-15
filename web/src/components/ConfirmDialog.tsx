import { useState, type ReactNode } from 'react';

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  digitar,
  onConfirm,
  onCancel,
}: {
  title: string;
  // ReactNode, e não string: a prévia da importação precisa listar o que vai
  // acontecer item a item — uma frase corrida esconderia justamente o detalhe
  // que a pessoa está tentando conferir antes de confirmar.
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Só libera o botão depois que a pessoa digita esta palavra (ex.: "confirmar"). */
  digitar?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [digitado, setDigitado] = useState('');
  const liberado = !digitar || digitado.trim().toLowerCase() === digitar.toLowerCase();
  // preventDefault além do stopPropagation: o diálogo pode viver DENTRO de um
  // <Link> (ex.: menu ⋯ do card da Biblioteca) — só cortar a propagação React
  // não cancela o default nativo da âncora, e qualquer clique navegaria.
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-xl bg-neutral-900 p-5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        <div className="mb-1 font-medium">{title}</div>
        <div className="mb-4 text-sm text-neutral-400">{message}</div>
        {digitar && (
          <label className="mb-4 block text-sm text-neutral-300">
            Digite <strong className="text-neutral-100">{digitar}</strong> para continuar
            <input
              autoFocus
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && liberado && onConfirm()}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 min-h-[44px] w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!liberado}
            className={`rounded-lg px-3 py-2 text-sm text-white disabled:opacity-40 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
