import { NavLink } from 'react-router-dom';

// O menu principal: os cursos (vídeo) e os PDFs (livros, questões, apostilas)
// são estantes separadas, cada uma com o seu jeito de adicionar e de filtrar.
export default function AbasPrincipais() {
  const aba = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-[44px] items-center border-b-2 px-1 text-2xl font-semibold tracking-tight outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
      isActive ? 'border-blue-500 text-neutral-50' : 'border-transparent text-neutral-500 hover:text-neutral-300'
    }`;
  return (
    <nav aria-label="Estantes" className="flex gap-6">
      <NavLink to="/" end className={aba}>
        Cursos
      </NavLink>
      <NavLink to="/pdfs" className={aba}>
        PDFs
      </NavLink>
    </nav>
  );
}
