import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Collection, type CourseSummary, type Documento } from '../api/client';
import { formatDuration } from '../lib/format';
import { CapaAula } from './CapaAula';
import { CaixaConcluida } from './CaixaConcluida';
import { Play } from './icons';

// Os resultados da busca do menu principal: cursos e PDFs pelo título (já estão na
// tela, a busca é aqui mesmo) e as aulas de todos os cursos, que só o servidor tem.

const paraBusca = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const bate = (palavras: string[], t: string) => {
  const n = paraBusca(t);
  return palavras.every((p) => n.includes(p));
};

/** Espera a pessoa parar de digitar: cada letra não vira uma varredura das aulas. */
function useAtrasado(valor: string, ms: number): string {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function ResultadosDaBusca({
  busca,
  cursos,
  docs,
  cats,
}: {
  busca: string;
  cursos: CourseSummary[];
  docs: Documento[];
  cats: Collection[];
}) {
  const q = busca.trim();
  const atrasada = useAtrasado(q, 200);
  const palavras = paraBusca(q).split(/\s+/).filter(Boolean);
  const { data: aulas, isFetching } = useQuery({
    queryKey: ['busca', 'aulas', atrasada],
    queryFn: () => api.buscarAulas(atrasada),
    enabled: atrasada !== '',
    placeholderData: (antes) => antes,
  });

  const nomeDaCategoria = (id: string | null) => {
    if (!id) return 'Sem categoria';
    const c = cats.find((x) => x.id === id);
    return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : 'Sem categoria';
  };
  const cursosAchados = cursos.filter((c) => bate(palavras, c.title));
  const pdfsAchados = docs.filter((d) => bate(palavras, d.titulo));
  const esperando = atrasada !== q || (isFetching && !aulas);
  const nada = !cursosAchados.length && !pdfsAchados.length && !aulas?.aulas.length && !esperando;

  const titulo = 'mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400';

  return (
    <div className="space-y-10" aria-live="polite">
      {nada && <p className="py-12 text-center text-sm text-neutral-500">Nada com “{q}” nos cursos, aulas e PDFs.</p>}

      {cursosAchados.length > 0 && (
        <section>
          <h2 className={titulo}>Cursos · {cursosAchados.length}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cursosAchados.map((c) => (
              <Link
                key={c.id}
                to={`/course/${c.id}`}
                className="flex items-center gap-3 rounded-lg bg-neutral-900 p-2 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded bg-neutral-800">
                  <span className="absolute inset-0 grid place-items-center text-neutral-600">
                    <Play size={16} />
                  </span>
                  <CapaAula src={api.courseCoverUrl(c.id)} className="absolute inset-0 h-full w-full object-cover" loading="lazy" ocultar="display" />
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm text-neutral-100">{c.title}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {nomeDaCategoria(c.collectionId)} · {c.completedLessons}/{c.totalLessons} aulas
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(aulas?.aulas.length ?? 0) > 0 && aulas && (
        <section>
          <h2 className={titulo}>
            Aulas · {aulas.total}
            {aulas.total > aulas.aulas.length && (
              <span className="ml-2 font-normal normal-case tracking-normal text-neutral-500">
                mostrando as {aulas.aulas.length} primeiras; digite mais para afunilar
              </span>
            )}
          </h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 lg:grid-cols-2">
            {aulas.aulas.map((a) => (
              <Link
                key={a.id}
                to={`/lesson/${a.id}`}
                className="flex items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <CapaAula src={api.lessonThumbUrl(a.id)} className="aspect-video w-20 shrink-0 rounded" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm">
                    {a.concluida && <CaixaConcluida feito size={13} />}
                    <span className={`truncate ${a.concluida ? 'text-neutral-400' : 'text-neutral-100'}`}>{a.titulo}</span>
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {a.curso}
                    {a.modulo ? ` · ${a.modulo.split('/').join(' › ')}` : ''}
                  </span>
                </span>
                {a.duracaoSec != null && <span className="shrink-0 text-xs text-neutral-500">{formatDuration(a.duracaoSec)}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {pdfsAchados.length > 0 && (
        <section>
          <h2 className={titulo}>PDFs · {pdfsAchados.length}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pdfsAchados.map((d) => (
              <Link
                key={d.id}
                to={`/pdf/${d.id}`}
                className="flex items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <span className="grid h-10 w-8 shrink-0 place-items-center rounded bg-neutral-800 text-[10px] font-semibold text-neutral-400">PDF</span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm text-neutral-100">{d.titulo}</span>
                  <span className="block truncate text-xs text-neutral-500">{nomeDaCategoria(d.categoriaId)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {esperando && !aulas && <p className="text-sm text-neutral-500">Procurando nas aulas…</p>}
    </div>
  );
}
