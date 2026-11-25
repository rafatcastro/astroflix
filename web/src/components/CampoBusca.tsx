import type { Ref } from 'react';
import { Lupa, X } from './icons';

// O campo que filtra as aulas do curso (página do curso e lateral do player).
// Esc limpa: com a lista filtrada, é o caminho mais curto de volta para ela inteira.
export function CampoBusca({
  valor,
  onMudar,
  className = '',
  placeholder = 'Buscar aulas deste curso',
  inputRef,
}: {
  valor: string;
  onMudar: (v: string) => void;
  className?: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className={`relative ${className}`}>
      <Lupa size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
      <input
        ref={inputRef}
        type="search"
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && valor) {
            e.stopPropagation();
            onMudar('');
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 pl-9 pr-9 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-blue-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {valor && (
        <button
          type="button"
          onClick={() => onMudar('')}
          aria-label="Limpar busca"
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-neutral-400 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
