import { useEffect, useRef } from 'react';
import { useCourse } from '../api/hooks';
import { api } from '../api/client';
import { formatDuration } from '../lib/format';

// Lista de aulas ao lado do vídeo (estilo YouTube): fica sempre à vista, então
// trocar de aula não pede abrir painel nem sair da tela cheia. A aula atual vem
// destacada e a lista rola até ela, inclusive ao avançar sozinha para a próxima.
export default function PlaylistSidebar({
  courseId,
  currentLessonId,
  onJump,
}: {
  courseId: string;
  currentLessonId: string;
  onJump: (lessonId: string) => void;
}) {
  const { data } = useCourse(courseId);
  const atualRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    atualRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentLessonId, data]);

  if (!data) return <p className="p-3 text-sm text-neutral-500">Carregando…</p>;
  const todas = data.modules.flatMap((m) => m.lessons);
  const posicao = new Map(todas.map((l, i) => [l.id, i + 1]));

  return (
    <div>
      {data.modules.map((m) => {
        const feitas = m.lessons.filter((l) => l.completed).length;
        return (
          <section key={m.name ?? '__flat__'}>
            {m.name && (
              <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-neutral-950 px-3 pb-1 pt-3 text-xs">
                <span className="truncate font-medium text-neutral-300">{m.name}</span>
                <span className="shrink-0 text-neutral-500">
                  {feitas}/{m.lessons.length}
                </span>
              </div>
            )}
            {m.lessons.map((l) => {
              const atual = l.id === currentLessonId;
              const estado = atual ? '▶' : l.completed ? '✓' : l.position > 0 ? '◐' : '';
              return (
                <button
                  key={l.id}
                  ref={atual ? atualRef : undefined}
                  type="button"
                  onClick={() => onJump(l.id)}
                  aria-current={atual ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                    atual ? 'bg-blue-600/25' : 'hover:bg-neutral-800/70'
                  }`}
                >
                  <span className={`w-5 shrink-0 text-center text-xs ${l.completed && !atual ? 'text-green-400' : 'text-neutral-500'}`}>
                    {estado || posicao.get(l.id)}
                  </span>
                  <span className="relative shrink-0">
                    <img
                      src={api.lessonThumbUrl(l.id)}
                      alt=""
                      className="aspect-video w-24 rounded bg-neutral-800 object-cover"
                      loading="lazy"
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
                    />
                    {l.durationSec != null && (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[10px] text-neutral-200">
                        {formatDuration(l.durationSec)}
                      </span>
                    )}
                  </span>
                  <span className={`line-clamp-2 min-w-0 flex-1 ${l.completed && !atual ? 'text-neutral-400' : 'text-neutral-100'}`}>
                    {l.title}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
