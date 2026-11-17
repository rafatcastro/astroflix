import { getPref, setPref } from './prefs';

/** "sistema" segue o macOS/Windows; os outros fixam. O padrão é seguir o sistema. */
export type Tema = 'sistema' | 'claro' | 'escuro';

const CHAVE = 'tema';

export function temaSalvo(): Tema {
  const t = getPref<string>(CHAVE, 'sistema');
  return t === 'claro' || t === 'escuro' ? t : 'sistema';
}

/**
 * Aplica e guarda. As cores vêm do CSS (index.css): "sistema" é só tirar o
 * data-tema e deixar a media query decidir. A janela do Tauri também recebe o
 * tema, para a barra de título acompanhar (no macOS ela seguia o sistema e
 * ficava clara sobre o app escuro, ou o contrário).
 */
export function aplicarTema(t: Tema, salvar = true): void {
  if (salvar) setPref(CHAVE, t);
  const raiz = document.documentElement;
  if (t === 'sistema') delete raiz.dataset.tema;
  else raiz.dataset.tema = t;
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(t === 'sistema' ? null : t === 'claro' ? 'light' : 'dark'))
    .catch(() => {
      /* fora do Tauri (pnpm dev no navegador) ou sem permissão: só a barra fica como está */
    });
}
