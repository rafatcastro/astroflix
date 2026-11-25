import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { formatDuration } from '../lib/format';
import { useTocando } from '../lib/tocando';
import { CapaAula } from './CapaAula';
import { Pause, Play, X } from './icons';

// A barra de baixo, em todas as telas: a aula que está tocando (ou a última vista),
// com o progresso e o botão de tocar. Na página da aula ela comanda o próprio vídeo;
// fora dela, o vídeo já parou (só um toca por vez) e o botão leva de volta à aula,
// que retoma de onde parou.
const ALTURA = '4rem';

export default function BarraTocando() {
  const { aula, alternar, fechar } = useTocando();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // As telas abrem espaço para a barra (index.css usa a variável no h-screen e no body).
  useEffect(() => {
    const raiz = document.documentElement;
    if (aula) raiz.style.setProperty('--barra-tocando', ALTURA);
    else raiz.style.removeProperty('--barra-tocando');
    return () => {
      raiz.style.removeProperty('--barra-tocando');
    };
  }, [aula]);

  if (!aula) return null;
  const naAula = pathname === `/lesson/${aula.id}`;
  const pct = aula.duracaoSec ? Math.min(100, (aula.posicaoSec / aula.duracaoSec) * 100) : 0;
  const tocar = () => {
    if (!alternar()) navigate(`/lesson/${aula.id}`);
  };

  return (
    <div
      role="region"
      aria-label="Aula tocando"
      style={{ height: ALTURA }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-sm"
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800">
        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mx-auto flex h-full max-w-screen-2xl items-center gap-3 px-4">
        <Link
          to={`/lesson/${aula.id}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <CapaAula src={api.lessonThumbUrl(aula.id)} className="aspect-video w-20 shrink-0 rounded" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-neutral-100">{aula.titulo}</span>
            <span className="block truncate text-xs text-neutral-400">
              {aula.curso}
              {aula.modulo ? ` · ${aula.modulo.split('/').join(' › ')}` : ''}
            </span>
          </span>
        </Link>
        <span className="hidden shrink-0 text-xs tabular-nums text-neutral-400 sm:block">
          {formatDuration(aula.posicaoSec)}
          {aula.duracaoSec ? ` / ${formatDuration(aula.duracaoSec)}` : ''}
        </span>
        <button
          type="button"
          onClick={tocar}
          aria-label={aula.tocando ? 'Pausar' : naAula ? 'Tocar' : 'Continuar a aula'}
          title={aula.tocando ? 'Pausar' : naAula ? 'Tocar' : 'Continuar a aula'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-950 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {aula.tocando ? <Pause size={18} /> : <Play size={18} />}
        </button>
        {!naAula && (
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar a barra"
            className="grid h-11 w-11 shrink-0 place-items-center rounded text-neutral-500 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
