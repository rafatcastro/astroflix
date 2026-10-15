import { useState } from 'react';

// Criar ou editar uma categoria: o nome e o emoji que a representa no menu
// principal. A grade traz os de estudo mais comuns; qualquer outro entra pelo
// campo (no macOS, Ctrl+Cmd+Espaço abre o seletor do sistema ali).

const SUGESTOES = [
  '🎓', '📚', '📖', '📝', '✏️', '🧠', '💡', '🎯',
  '💻', '🖥️', '🤖', '🧮', '📊', '📈', '🔬', '🧪',
  '⚖️', '🏛️', '🩺', '💊', '🏗️', '⚙️', '🔧', '🌎',
  '🇺🇸', '🇪🇸', '🗣️', '🎵', '🎨', '📷', '🎬', '💼',
  '💰', '🏆', '⭐', '🔥', '🚀', '🌱', '❤️', '🧘',
];

const campo =
  'min-h-[44px] w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600';

// Um emoji: sem letra nem número (o mesmo critério do servidor) e curto.
const ehEmoji = (t: string) => !!t && [...t].length <= 10 && !/[\p{L}\p{N}]/u.test(t);

export default function DialogoCategoria({
  inicial,
  aviso,
  onSalvar,
  onCancelar,
}: {
  /** Uma linha sob o título (ex.: o que vai para a categoria nova). */
  aviso?: string;
  /** Ausente: criar. */
  inicial?: { name: string; emoji: string | null };
  onSalvar: (c: { name: string; emoji: string | null }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial?.name ?? '');
  const [emoji, setEmoji] = useState<string | null>(inicial?.emoji ?? null);
  const [outro, setOutro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const editando = !!inicial;

  async function salvar() {
    if (!nome.trim() || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar({ name: nome.trim(), emoji });
    } catch {
      setErro('Não deu para salvar. Tente de novo.');
      setSalvando(false);
    }
  }

  const opcao = (ativo: boolean) =>
    `grid h-10 w-10 place-items-center rounded-lg text-xl transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
      ativo ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'hover:bg-neutral-800'
    }`;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onCancelar}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={editando ? 'Editar categoria' : 'Nova categoria'}
        className="w-full max-w-md rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancelar()}
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <h2 className="font-medium text-neutral-100">{editando ? 'Editar categoria' : 'Nova categoria'}</h2>
        {aviso && <p className="mt-1 text-sm text-neutral-400">{aviso}</p>}

        <div className="mt-4 flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-neutral-800 text-2xl" aria-hidden>
            {emoji ?? <span className="text-sm text-neutral-500">—</span>}
          </div>
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Pós em Engenharia"
            maxLength={80}
            autoComplete="off"
            aria-label="Nome"
            className={campo}
          />
        </div>

        <div className="mt-4 text-xs text-neutral-400">Emoji</div>
        <div className="mt-2 grid grid-cols-8 gap-1" role="radiogroup" aria-label="Emoji">
          {SUGESTOES.map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={emoji === e}
              aria-label={e}
              className={opcao(emoji === e)}
              onClick={() => setEmoji(emoji === e ? null : e)}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={outro}
            onChange={(e) => {
              const v = e.target.value.trim();
              setOutro(e.target.value);
              if (ehEmoji(v)) setEmoji(v);
            }}
            placeholder="Outro: cole ou digite um emoji"
            maxLength={16}
            aria-label="Outro emoji"
            className={campo}
          />
          {emoji && (
            <button
              type="button"
              className="min-h-[44px] shrink-0 rounded-lg px-3 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              onClick={() => {
                setEmoji(null);
                setOutro('');
              }}
            >
              Sem emoji
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-neutral-500">No Anki, as questões dela ficam em Astroflix::{nome.trim().replace(/::/g, ':') || '…'}.</p>
        {erro && (
          <p role="alert" className="mt-2 text-sm text-amber-300">
            {erro}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="min-h-[44px] px-3 text-sm text-neutral-400 hover:text-neutral-200" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!nome.trim() || salvando}
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {editando ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}
