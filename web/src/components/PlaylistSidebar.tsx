import { useEffect, useRef, useState } from 'react';
import { useCourse } from '../api/hooks';
import { api, type LessonDTO } from '../api/client';
import { formatDuration } from '../lib/format';
import { ChevronRight } from './icons';

interface Grupo {
  chave: string;
  nome: string;
  aulas: LessonDTO[];
}

const pastasDe = (l: LessonDTO) => l.relPath.split('/').filter(Boolean).slice(0, -1);

// Um grupo por pasta da aula. A pasta que embrulha o curso inteiro (ex.: tudo
// dentro de "Docker/") não conta, senão a lista vira um grupo só; o título
// perde o prefixo de pasta que o deriveCourse dobrou nele ("Pasta — Aula").
function agrupar(aulas: LessonDTO[]): { grupos: Grupo[]; titulos: Map<string, string> } {
  const pastas = aulas.map(pastasDe);
  let comum = 0;
  while (pastas.length && pastas.every((p) => p.length > comum + 1 && p[comum] === pastas[0][comum])) comum++;
  const grupos: Grupo[] = [];
  const titulos = new Map<string, string>();
  aulas.forEach((l, i) => {
    const chave = pastas[i].join('/');
    const nome = pastas[i].slice(comum).join(' / ');
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.chave === chave) ultimo.aulas.push(l);
    else grupos.push({ chave, nome, aulas: [l] });
    const prefixo = `${pastas[i].slice(1).join(' / ')} — `;
    titulos.set(l.id, pastas[i].length > 1 && l.title.startsWith(prefixo) ? l.title.slice(prefixo.length) : l.title);
  });
  return { grupos, titulos };
}

// Lista de aulas ao lado do vídeo (estilo YouTube): fica sempre à vista, então
// trocar de aula não pede abrir painel nem sair da tela cheia. A aula atual vem
// destacada e a lista rola até ela, inclusive ao avançar sozinha para a próxima.
// Os grupos começam recolhidos, menos o da aula atual; ao passar para uma aula
// de outro grupo, só esse fica aberto.
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
  const { grupos, titulos } = agrupar(todas);
  const grupoAtual = grupos.find((g) => g.aulas.some((l) => l.id === currentLessonId))?.chave ?? null;
  const [abertos, setAbertos] = useState<string[]>([]);

  useEffect(() => {
    if (grupoAtual !== null) setAbertos([grupoAtual]);
  }, [grupoAtual]);

  // Rola até a aula atual quando ela muda (ou o curso carrega) — inclusive se o
  // grupo dela só abriu no render seguinte —, mas não quando a pessoa abre outro grupo.
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

  return (
    <div>
      {grupos.map((g, i) => {
        const feitas = g.aulas.filter((l) => l.completed).length;
        const aberto = !g.nome || abertos.includes(g.chave);
        return (
          <section key={g.chave || '__flat__'}>
            {g.nome && (
              <button
                type="button"
                onClick={() => alternar(g.chave)}
                aria-expanded={aberto}
                aria-controls={`grupo-${i}`}
                className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-neutral-950 px-3 pb-1 pt-3 text-left text-xs hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-neutral-300">{g.nome}</span>
                <span className="shrink-0 text-neutral-500">
                  {feitas}/{g.aulas.length}
                </span>
              </button>
            )}
            {aberto && (
              <div id={`grupo-${i}`}>
                {g.aulas.map((l) => {
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
                        {titulos.get(l.id)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
