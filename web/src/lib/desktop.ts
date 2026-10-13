import type { MouseEvent } from 'react';

// O app desktop (desktop/, Tauri) carrega esta mesma interface numa webview. Lá,
// popup, aba nova e download não se comportam como no navegador — e o Google
// recusa login dentro de webview embutida. Este é o único lugar que sabe disso:
// fora do Tauri, tudo segue o caminho do navegador, sem mudança.

export function emDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Abre no navegador do sistema (desktop) ou numa aba nova (navegador). */
export async function abrirFora(url: string): Promise<void> {
  const absoluta = new URL(url, window.location.href).toString();
  if (!emDesktop()) {
    window.open(absoluta, '_blank', 'noopener');
    return;
  }
  // Import sob demanda: no navegador o plugin nem é carregado.
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(absoluta);
}

/**
 * onClick para links de download/aba nova: no desktop, troca a navegação da
 * webview pelo navegador do sistema; no navegador, deixa o link agir sozinho.
 */
export function cliqueFora(e: MouseEvent, url: string): void {
  if (!emDesktop()) return;
  e.preventDefault();
  void abrirFora(url);
}
