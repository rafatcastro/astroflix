import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { api } from '../api/client';

// O pdf.js (o leitor do Firefox) entra só quando alguém abre um PDF ou falta uma
// capa: é grande, e quem só assiste cursos não precisa carregá-lo.
// Build "legacy": a webview do macOS é o Safari do sistema, e num macOS mais
// antigo o build moderno usa recursos que ele ainda não tem.
let carregando: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

function pdfjs() {
  carregando ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return carregando;
}

/**
 * Abre o PDF pelo servidor. Com Range (servirArquivo), o pdf.js baixa só os
 * pedaços das páginas que desenha: um livro de 300 MB abre na hora.
 */
export async function abrirPdf(id: string): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({
    url: api.documentoArquivoUrl(id),
    disableAutoFetch: true,
    rangeChunkSize: 256 * 1024,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
}

// Uma capa de cada vez: a primeira abertura da aba com 200 PDFs não pode abrir
// 200 documentos ao mesmo tempo.
let fila: Promise<unknown> = Promise.resolve();

/** Desenha a primeira página como capa e manda ao servidor, junto com o número de páginas. */
export function gerarCapa(id: string): Promise<void> {
  const tarefa = fila.then(async () => {
    const doc = await abrirPdf(id);
    try {
      const pagina = await doc.getPage(1);
      const base = pagina.getViewport({ scale: 1 });
      const vp = pagina.getViewport({ scale: 360 / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await pagina.render({ canvas, viewport: vp }).promise;
      const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      if (png) await api.salvarCapaDocumento(id, png);
      await api.editarDocumento(id, { paginas: doc.numPages });
    } finally {
      void doc.destroy();
    }
  });
  fila = tarefa.catch(() => undefined);
  return tarefa;
}
