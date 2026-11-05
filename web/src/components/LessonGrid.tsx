import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, materialUrl } from '../api/client';
import { formatBytes, formatDuration } from '../lib/format';
import type { LessonDTO, MaterialDTO } from '../api/client';
import { KIND_LABEL } from './MaterialsSection';
import { tipoDeVisualizacao } from './VisualizadorArquivo';
import { IconeOffline } from './IconeOffline';
import { CapaAula } from './CapaAula';

// Aula ou arquivo (PDF, imagem, anexo) da pasta, na ordem em que estão nela.
const ehArquivo = (it: LessonDTO | MaterialDTO): it is MaterialDTO => 'kind' in it;

export default function LessonGrid({
  itens,
  titulos,
  size,
  onToggleComplete,
  onMenu,
  onAbrirArquivo,
}: {
  itens: Array<LessonDTO | MaterialDTO>;
  /** O título dentro da árvore de pastas (sem o prefixo da pasta); sem ele, o da aula. */
  titulos?: Map<string, string>;
  size: number;
  onToggleComplete: (id: string, completed: boolean) => void;
  /** Botão direito na aula (Baixar / Excluir download); só nos cursos do Drive e do Telegram. */
  onMenu?: (l: LessonDTO, e: MouseEvent) => void;
  /** Clique num arquivo: o que o app sabe mostrar abre no visualizador, o resto é baixado. */
  onAbrirArquivo: (m: MaterialDTO, e: MouseEvent) => void;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${size}px, 45vw), 1fr))` }}>
      {itens.map((l) =>
        ehArquivo(l) ? (
          <a
            key={l.id}
            href={materialUrl(l.id, true)}
            download={l.name}
            onClick={(e) => onAbrirArquivo(l, e)}
            className="overflow-hidden rounded-lg bg-neutral-900 hover:bg-neutral-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <div className="grid aspect-video place-items-center bg-neutral-800 text-sm font-semibold tracking-wide text-neutral-400">
              {KIND_LABEL[l.kind]}
            </div>
            <div className="p-2">
              <div className="truncate text-sm">{l.name}</div>
              <div className="flex justify-between text-xs text-neutral-500">
                <span>{formatBytes(l.sizeBytes)}</span>
                <span>{tipoDeVisualizacao(l.name) ? 'Abrir' : 'Baixar'}</span>
              </div>
            </div>
          </a>
        ) : (
        <div key={l.id} className="bg-neutral-900 rounded-lg overflow-hidden relative" onContextMenu={onMenu ? (e) => onMenu(l, e) : undefined}>
          <Link to={`/lesson/${l.id}`}>
            {/* Tocar pela rede é o normal da aula remota: nada de cinza. Só a que falta no disco fica apagada. */}
            <div className={`relative aspect-video overflow-hidden bg-neutral-800 ${l.missing ? 'opacity-40' : ''}`}>
              <CapaAula src={api.lessonThumbUrl(l.id)} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              {l.missing && <span className="absolute left-1 top-1 rounded bg-amber-900/80 px-1 text-[10px] text-amber-200">não encontrada</span>}
            </div>
            <div className="p-2">
              <div className="flex items-center gap-1 text-sm">
                <span className="truncate">{titulos?.get(l.id) ?? l.title}</span>
                {l.baixada === true && <IconeOffline />}
              </div>
              <div className="text-xs text-neutral-500 flex justify-between">
                <span>{formatDuration(l.durationSec)}</span>
                <span>{l.completed ? '✓' : l.position > 0 ? '▓' : '○'}</span>
              </div>
            </div>
          </Link>
          <label
            className="absolute top-1 right-1 grid h-11 w-11 place-items-center"
            title="Marcar como concluída"
          >
            <input
              type="checkbox"
              checked={l.completed}
              onChange={(e) => onToggleComplete(l.id, e.target.checked)}
              className="w-4 h-4"
              aria-label="Marcar como concluída"
            />
          </label>
        </div>
        ),
      )}
    </div>
  );
}
