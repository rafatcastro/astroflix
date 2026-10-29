import { useEffect, useRef, useState } from 'react';
import { useCourse } from '../api/hooks';
import { api } from '../api/client';
import { formatDuration } from '../lib/format';
import { caminhoDaAula, montarArvore, type No } from '../lib/arvore';
import { ChevronRight } from './icons';

// Lista de aulas ao lado do vídeo (estilo YouTube): fica sempre à vista, então
// trocar de aula não pede abrir painel nem sair da tela cheia. A aula atual vem
// destacada e a lista rola até ela, inclusive ao avançar sozinha para a próxima.
// As pastas começam recolhidas, menos o caminho da aula atual; ao passar para uma
// aula de outra pasta, só o caminho dela fica aberto.
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
  const todas = data ? data.modules.flatMap((m) => m.lessons) : [];
  const arvore = montarArvore(todas);
  const caminhoAtual = caminhoDaAula(arvore, currentLessonId).join('\n');
  const [abertos, setAbertos] = useState<string[]>([]);

  useEffect(() => {
    setAbertos(caminhoAtual ? caminhoAtual.split('\n') : []);
  }, [caminhoAtual]);

  // Rola até a aula atual quando ela muda (ou o curso carrega) — inclusive se a
  // pasta dela só abriu no render seguinte —, mas não quando a pessoa abre outra pasta.
  const rolarRef = useRef(true);
  useEffect(() => {
    rolarRef.current = true;
  }, [currentLessonId, data]);
  useEffect(() => {
    if (!rolarRef.current || !atualRef.current) return;
    atualRef.current.scrollIntoView({ block: 'nearest' });
    rolarRef.current = false;
  });

  if (!data) return <p className="p-3 text-sm text-neutral-500">Carregando…</p>;
  const posicao = new Map(todas.map((l, i) => [l.id, i + 1]));
  const alternar = (chave: string) =>
    setAbertos((a) => (a.includes(chave) ? a.filter((c) => c !== chave) : [...a, chave]));

  const nivel = (nos: No[], profundidade: number) =>
    nos.map((no) => {
      // Cada nível recua um pouco: com a árvore toda aberta, dá para ver de que pasta é cada aula.
      const recuo = { paddingLeft: `${0.75 + profundidade * 0.75}rem` };
      if (no.tipo === 'pasta') {
        const aberto = abertos.includes(no.chave);
        const feitas = no.aulas.filter((l) => l.completed).length;
        const id = `pasta-${no.chave}`;
        return (
          <section key={no.chave}>
            <button
              type="button"
              onClick={() => alternar(no.chave)}
              aria-expanded={aberto}
              aria-controls={id}
              style={recuo}
              className={`flex w-full items-center gap-1.5 bg-neutral-950 pb-1 pr-3 pt-3 text-left text-xs hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                profundidade === 0 ? 'sticky top-0 z-10' : ''
              }`}
            >
              <ChevronRight
                size={14}
                className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-neutral-300">{no.nome}</span>
              <span className="shrink-0 text-neutral-500">
                {feitas}/{no.aulas.length}
              </span>
            </button>
            {aberto && <div id={id}>{nivel(no.filhos, profundidade + 1)}</div>}
          </section>
        );
      }
      const l = no.aula;
      const atual = l.id === currentLessonId;
      const estado = atual ? '▶' : l.completed ? '✓' : l.position > 0 ? '◐' : '';
      return (
        <button
          key={l.id}
          ref={atual ? atualRef : undefined}
          type="button"
          onClick={() => onJump(l.id)}
          aria-current={atual ? 'true' : undefined}
          style={recuo}
          className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
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
            {no.titulo}
          </span>
        </button>
      );
    });

  return <div>{nivel(arvore, 0)}</div>;
}
