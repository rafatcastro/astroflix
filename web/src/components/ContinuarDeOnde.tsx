import { Link } from 'react-router-dom';
import { api, type Collection, type CourseSummary } from '../api/client';
import { formatDuration } from '../lib/format';
import { CapaAula } from './CapaAula';
import { Play } from './icons';

// A última aula que a pessoa estava vendo, no topo do menu principal: abrir o app
// e voltar à aula é o caminho mais comum, e antes pedia entrar na categoria e no curso.
export function ContinuarDeOnde({ cursos, cats }: { cursos: CourseSummary[]; cats: Collection[] }) {
  const curso = cursos
    .filter((c) => c.ultimaAula && c.lastActivityAt)
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))[0];
  if (!curso?.ultimaAula) return null;
  const aula = curso.ultimaAula;
  const cat = cats.find((c) => c.id === curso.collectionId);
  const pct = aula.duracaoSec ? Math.min(100, (aula.posicaoSec / aula.duracaoSec) * 100) : null;

  return (
    <section aria-label="Continuar de onde parou" className="mb-8">
      <Link
        to={`/lesson/${aula.id}`}
        className="group flex items-center gap-4 rounded-xl bg-neutral-900 p-4 outline-none hover:ring-2 hover:ring-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600 sm:gap-5"
      >
        <span className="relative shrink-0">
          <CapaAula src={api.lessonThumbUrl(aula.id)} className="aspect-video w-28 rounded-lg sm:w-48" />
          {pct != null && (
            <span className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-lg bg-neutral-950/70">
              <span className="block h-full bg-blue-500" style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs uppercase tracking-wide text-blue-400">Continuar de onde parou</span>
          <span className="mt-0.5 line-clamp-2 font-medium text-neutral-50 sm:text-lg">{aula.titulo}</span>
          <span className="mt-0.5 block truncate text-sm text-neutral-400">
            {curso.title}
            {cat ? ` · ${cat.emoji ? `${cat.emoji} ` : ''}${cat.name}` : ''}
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            Parou em {formatDuration(aula.posicaoSec)}
            {aula.duracaoSec ? ` de ${formatDuration(aula.duracaoSec)}` : ''}
          </span>
        </span>
        <span className="hidden h-11 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white group-hover:bg-blue-500 sm:inline-flex">
          <Play size={16} /> Continuar
        </span>
      </Link>
    </section>
  );
}
