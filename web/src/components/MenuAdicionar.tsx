import { useState } from 'react';
import { Plus } from './icons';

// O botão Adicionar do cabeçalho de cada aba (Cursos, PDFs): o mesmo botão e o
// mesmo menu, só com as origens de cada uma. Fica sempre no cabeçalho, ao lado
// das Configurações, inclusive com a aba vazia: um lugar só para adicionar.

export interface OpcaoAdicionar {
  rotulo: string;
  descricao: string;
  onClick: () => void;
}

export default function MenuAdicionar({ opcoes }: { opcoes: OpcaoAdicionar[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors motion-reduce:transition-none hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <Plus size={18} /> Adicionar
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 text-left"
            onKeyDown={(e) => e.key === 'Escape' && setAberto(false)}
          >
            {opcoes.map((o, i) => (
              <button
                key={o.rotulo}
                type="button"
                role="menuitem"
                autoFocus={i === 0}
                className="block w-full px-3 py-2.5 text-left text-sm hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
                onClick={() => {
                  setAberto(false);
                  o.onClick();
                }}
              >
                {o.rotulo}
                <div className="text-xs text-neutral-500">{o.descricao}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
