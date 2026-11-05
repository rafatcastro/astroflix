import type { MaterialDTO } from '../api/client';

// O rótulo do tipo dos arquivos do curso que não são vídeo, no lugar da capa
// (eles abrem pelo VisualizadorArquivo).

export const KIND_LABEL: Record<MaterialDTO['kind'], string> = {
  pdf: 'PDF', zip: 'ZIP', archive: 'ARQ', doc: 'DOC', image: 'IMG', other: 'ARQ',
};
