import { materialUrl, type MaterialDTO } from '../api/client';
import { cliqueFora } from '../lib/desktop';

// Os arquivos do curso que não são vídeo (pdf/zip/imagem/doc) entram na lista
// como itens, entre as aulas. Aqui ficam o rótulo do tipo e o visualizador de PDF
// e imagem. Acesso apenas: nunca toca no arquivo no disco.

export const KIND_LABEL: Record<MaterialDTO['kind'], string> = {
  pdf: 'PDF', zip: 'ZIP', archive: 'ARQ', doc: 'DOC', image: 'IMG', other: 'ARQ',
};

export type Visualizado = { kind: 'pdf' | 'image'; id: string; name: string } | null;

export function VisualizadorMaterial({ viewer, onFechar }: { viewer: NonNullable<Visualizado>; onFechar: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/90 p-3 sm:p-6" onClick={() => onFechar()}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-neutral-200">{viewer.name}</span>
        <div className="flex shrink-0 gap-2">
          <a
            href={materialUrl(viewer.id, true)}
            download={viewer.name}
            onClick={(e) => {
              e.stopPropagation();
              cliqueFora(e, materialUrl(viewer.id, true));
            }}
            className="min-h-[44px] rounded-lg bg-neutral-800 px-3 text-sm leading-[44px] text-neutral-200 hover:bg-neutral-700"
          >
            Baixar
          </a>
          <button
            type="button"
            onClick={() => onFechar()}
            className="min-h-[44px] rounded-lg bg-neutral-800 px-3 text-sm text-neutral-200 hover:bg-neutral-700"
          >
            Fechar
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {viewer.kind === 'pdf' ? (
          <iframe title={viewer.name} src={materialUrl(viewer.id)} className="h-full w-full rounded-lg border-0 bg-white" />
        ) : (
          <div className="grid h-full place-items-center">
            <img src={materialUrl(viewer.id)} alt={viewer.name} className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}
