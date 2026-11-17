import { useEffect, useState } from 'react';
import TextField from './TextField';

// Um diálogo de um campo só (renomear a aula, criar uma sub-playlist): Enter
// salva, Esc fecha. `onSalvar` que rejeita mostra o erro e deixa o diálogo aberto.
export default function DialogoTexto({
  titulo,
  rotulo,
  inicial = '',
  dica,
  botao = 'Salvar',
  permitirVazio = false,
  onSalvar,
  onClose,
}: {
  titulo: string;
  rotulo: string;
  inicial?: string;
  dica?: string;
  botao?: string;
  /** Vazio é uma resposta válida (renomear: volta ao nome do arquivo). */
  permitirVazio?: boolean;
  onSalvar: (valor: string) => Promise<void>;
  onClose: () => void;
}) {
  const [valor, setValor] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const salvar = async () => {
    if ((!valor.trim() && !permitirVazio) || salvando) return;
    setSalvando(true);
    try {
      await onSalvar(valor.trim());
      onClose();
    } catch {
      setErro('Não foi possível salvar.');
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialogo-texto-titulo" className="w-full max-w-md rounded-xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div id="dialogo-texto-titulo" className="mb-3 font-medium">
          {titulo}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <label htmlFor="dialogo-texto-campo" className="mb-1 block text-sm text-neutral-300">
            {rotulo}
          </label>
          <TextField id="dialogo-texto-campo" autoFocus value={valor} onChange={(e) => setValor(e.target.value)} onFocus={(e) => e.target.select()} />
          {dica && <p className="mt-1 text-xs text-neutral-500">{dica}</p>}
          {erro && (
            <p role="alert" className="mt-2 text-sm text-amber-200">
              {erro}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={(!valor.trim() && !permitirVazio) || salvando}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
            >
              {salvando ? 'Salvando…' : botao}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
