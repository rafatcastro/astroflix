import type { MouseEvent } from 'react';

// A interface só roda dentro do app desktop (desktop/, Tauri), numa webview. Lá,
// aba nova e download não se comportam como num navegador — e o Google recusa
// login dentro de webview embutida. Por isso o que é para abrir "fora" vai para
// o navegador do sistema, por aqui.

/** Abre a URL (relativa ou absoluta) no navegador do sistema. */
export async function abrirFora(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(new URL(url, window.location.href).toString());
}

/** onClick para links de download/aba nova: troca a navegação da webview pelo navegador do sistema. */
export function cliqueFora(e: MouseEvent, url: string): void {
  e.preventDefault();
  void abrirFora(url);
}

/**
 * Seletor de pasta nativo (Finder, Explorer, GTK). Antes era um navegador de
 * pastas feito à mão, listando os volumes, que ninguém reconhecia. Devolve null
 * se a pessoa cancelar.
 */
export async function escolherPasta(titulo: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ directory: true, multiple: false, title: titulo });
  return typeof r === 'string' ? r : null;
}

/** Seletor nativo de um ou vários PDFs. Devolve [] se a pessoa cancelar. */
export async function escolherPdfs(titulo: string, varios = true): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ multiple: varios, directory: false, title: titulo, filters: [{ name: 'PDF', extensions: ['pdf', 'PDF'] }] });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}
