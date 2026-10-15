import type { LinkDrive } from './tipos';

// Ids do Drive são alfanuméricos com "-" e "_"; o limite de 10 evita que um
// texto qualquer curto (ex.: "pasta") seja tomado por id.
const ID = /^[\w-]{10,}$/;

// Aceita o link colado da barra do navegador (com ou sem conta /u/N), o formato
// antigo open?id= e o id puro. O host é conferido por igualdade exata: um
// "drive.google.com.exemplo.com" não pode passar.
const CAMINHO_PASTA = /^\/drive\/(?:u\/\d+\/)?folders\/([^/]+)\/?$/;

export function parseLinkDrive(texto: string): LinkDrive | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  if (ID.test(limpo)) return { folderId: limpo, resourceKey: null };

  let url: URL;
  try {
    url = new URL(limpo);
  } catch {
    return null;
  }
  if (url.hostname !== 'drive.google.com') return null;

  let folderId: string | null = null;
  const pasta = CAMINHO_PASTA.exec(url.pathname);
  if (pasta) folderId = pasta[1] ?? null;
  else if (url.pathname === '/open') folderId = url.searchParams.get('id');

  if (!folderId || !ID.test(folderId)) return null;

  // resourcekey só existe em links compartilhados por ele; sem ele o id basta.
  const resourceKey = url.searchParams.get('resourcekey') || null;
  return { folderId, resourceKey };
}

// PDF do Drive: o link pode ser de um arquivo (/file/d/<id>/view, compartilhado
// pelo "Copiar link") ou de uma pasta, cujos PDFs entram todos. O tipo só se
// sabe perguntando ao Drive: o id puro e o open?id= servem para os dois.
const CAMINHO_ARQUIVO = /^\/file\/(?:u\/\d+\/)?d\/([^/]+)(?:\/[^/]*)?\/?$/;

export function parseLinkArquivoOuPastaDrive(texto: string): { id: string; resourceKey: string | null } | null {
  const pasta = parseLinkDrive(texto);
  if (pasta) return { id: pasta.folderId, resourceKey: pasta.resourceKey };
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    return null;
  }
  if (url.hostname !== 'drive.google.com') return null;
  const m = CAMINHO_ARQUIVO.exec(url.pathname);
  const id = m?.[1];
  if (!id || !ID.test(id)) return null;
  return { id, resourceKey: url.searchParams.get('resourcekey') || null };
}
