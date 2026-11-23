import type { LessonDTO } from '../api/client';

// A marca de "concluído" em todo o app: um checkbox (quadrado verde com o visto), mais
// fácil de achar de relance numa lista longa do que o ✓ solto. Vazio = ainda não.
export function CaixaConcluida({ feito, size = 14, className = '' }: { feito: boolean; size?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={feito ? 'Concluído' : 'Não concluído'}
      style={{ width: size, height: size }}
      className={`inline-grid shrink-0 place-items-center rounded-[3px] border ${
        feito ? 'border-green-500 bg-green-500 text-neutral-950' : 'border-neutral-600'
      } ${className}`}
    >
      {feito && (
        <svg viewBox="0 0 16 16" width={size - 4} height={size - 4} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      )}
    </span>
  );
}

// O módulo está concluído quando todos os vídeos .mp4 de dentro estão: os outros
// formatos (gravações soltas, .mkv que não toca) não seguram o módulo aberto.
export function moduloConcluido(aulas: LessonDTO[]): boolean {
  const mp4 = aulas.filter((l) => /\.mp4$/i.test(l.relPath) && !l.missing);
  return mp4.length > 0 && mp4.every((l) => l.completed);
}
