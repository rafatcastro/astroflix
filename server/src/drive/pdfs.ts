import type { ArquivoDrive, ClienteDrive } from './api';
import { FalhaDrive } from './tipos';

// Os PDFs de um link do Drive: o próprio arquivo, ou todos os de uma pasta
// (subpastas inclusive). Atalhos valem pelo alvo; cada pasta é listada uma vez
// (um atalho para um ancestral faria a recursão nunca terminar), e há teto,
// como na pasta local: uma pasta enorme não pode prender o pedido.

const PASTA = 'application/vnd.google-apps.folder';
const ATALHO = 'application/vnd.google-apps.shortcut';
const PDF = 'application/pdf';
const MAX_PDFS = 2000;
const MAX_PASTAS = 500;

export interface PdfDrive {
  id: string;
  nome: string;
  tamanho: number;
  /** Valor do cabeçalho de resource key para ler este arquivo ("<id>/<chave>", separados por vírgula). */
  resourceKeys: string | null;
}

const chaveDe = (a: { id: string; resourceKey?: string }) => (a.resourceKey ? `${a.id}/${a.resourceKey}` : null);
const juntar = (...ks: Array<string | null>) => ks.filter(Boolean).join(',') || null;

export async function pdfsDoDrive(cliente: ClienteDrive, id: string, chaveDoLink: string | null): Promise<{ titulo: string; pdfs: PdfDrive[] }> {
  const raiz = await cliente.getArquivo(id);
  const chaveRaiz = juntar(chaveDoLink ? `${id}/${chaveDoLink}` : null, chaveDe(raiz));
  if (raiz.mimeType === PDF) {
    return { titulo: raiz.name, pdfs: [{ id: raiz.id, nome: raiz.name, tamanho: Number(raiz.size ?? 0), resourceKeys: chaveRaiz }] };
  }
  if (raiz.mimeType !== PASTA) throw new FalhaDrive('nao-e-pasta');

  const pdfs: PdfDrive[] = [];
  const visitadas = new Set<string>([raiz.id]);
  const fila: Array<{ id: string; chaves: string | null }> = [{ id: raiz.id, chaves: chaveRaiz }];
  while (fila.length && pdfs.length < MAX_PDFS && visitadas.size <= MAX_PASTAS) {
    const pasta = fila.shift()!;
    const filhos = (await cliente.listarFilhos(pasta.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    for (const f of filhos) {
      const alvo: ArquivoDrive =
        f.mimeType === ATALHO && f.shortcutDetails
          ? { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType }
          : f;
      const chaves = juntar(pasta.chaves, chaveDe(alvo));
      if (alvo.mimeType === PDF) {
        pdfs.push({ id: alvo.id, nome: f.name, tamanho: Number(alvo.size ?? 0), resourceKeys: chaves });
        if (pdfs.length >= MAX_PDFS) break;
      } else if (alvo.mimeType === PASTA && !visitadas.has(alvo.id)) {
        visitadas.add(alvo.id);
        fila.push({ id: alvo.id, chaves });
      }
    }
  }
  return { titulo: raiz.name, pdfs };
}
