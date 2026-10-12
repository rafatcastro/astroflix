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
