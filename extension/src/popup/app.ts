// A conversa do popup com o Astroflix. O app escuta em 127.0.0.1, na 7777 ou na
// próxima livre, então a porta é procurada e lembrada.

const PORTAS = Array.from({ length: 21 }, (_, i) => 7777 + i);

export interface Config {
  porta: number | null;
  chave: string | null;
  ultimaPlaylist: string | null;
}

export interface Modulo {
  pasta: string;
  nome: string;
  itens: number;
}

export interface Playlist {
  id: string;
  titulo: string;
  itens: number;
  modulos?: Modulo[];
}

/** Um vídeo que o background.js viu a aba pedir. */
export interface VideoVisto {
  url: string;
  pagina: string | null;
  cabecalhos: { nome: string; valor: string }[];
  quando: number;
}

/** O "Importar várias aulas" em andamento, gravado pelo background.js. */
export interface Lote {
  ativo?: boolean;
  total?: number | null;
  feitos?: number;
  falhas?: string[];
  atual?: string | null;
  terminou?: string | null;
}

export type ErroDoApp = 'sem-app' | 'chave-errada' | 'precisa-entrar';

export const ERROS: Record<string, string> = {
  'sem-app': 'O Astroflix não respondeu. Abra o app e tente de novo.',
  'chave-errada': 'Chave errada. Copie de novo em Configurações → Extensão do navegador.',
  'precisa-entrar': 'Entre na sua conta no Astroflix primeiro.',
};

export async function lerConfig(): Promise<Config> {
  const c = (await chrome.storage.local.get(['porta', 'chave', 'ultimaPlaylist'])) as Partial<Config>;
  return { porta: c.porta ?? null, chave: c.chave ?? null, ultimaPlaylist: c.ultimaPlaylist ?? null };
}

export async function api<T = unknown>(cfg: Config, caminho: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${cfg.porta}${caminho}`, {
    ...init,
    headers: {
      'X-Astroflix-Chave': cfg.chave ?? '',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(corpo.error ?? `HTTP ${res.status}`), { status: res.status });
  return corpo as T;
}

export async function acharApp(chave: string, portaLembrada: number | null): Promise<{ porta: number } | { erro: ErroDoApp }> {
  const ordem = portaLembrada ? [portaLembrada, ...PORTAS.filter((p) => p !== portaLembrada)] : PORTAS;
  for (const porta of ordem) {
    try {
      const res = await fetch(`http://127.0.0.1:${porta}/api/extensao/ping`, {
        headers: { 'X-Astroflix-Chave': chave },
        signal: AbortSignal.timeout(800),
      });
      if (res.status === 401 || res.status === 403) {
        const c = await res.json().catch(() => ({}));
        if (c.error === 'chave-errada') return { erro: 'chave-errada' };
        if (c.error === 'precisa-entrar') return { erro: 'precisa-entrar' };
        continue;
      }
      if (res.ok) return { porta };
    } catch {
      /* porta fechada: a próxima */
    }
  }
  return { erro: 'sem-app' };
}

/**
 * As playlists e, se a escolhida guardada foi movida para dentro de outra, o valor
 * novo dela ("id|subpasta"). Sem isso o popup caía na primeira da lista, e as
 * aulas iam para a raiz.
 */
export async function playlistsComDestino(cfg: Config, alvo: string | null): Promise<{ playlists: Playlist[]; alvo: string | null }> {
  const playlists = await api<Playlist[]>(cfg, '/api/extensao/playlists');
  const valores = new Set(playlists.flatMap((p) => [`${p.id}|`, ...(p.modulos ?? []).map((m) => `${p.id}|${m.pasta}`)]));
  if (alvo && !valores.has(alvo)) {
    const [id, modulo] = alvo.split('|');
    const r = await api<{ valor?: string }>(cfg, `/api/extensao/playlists/${id}/destino?modulo=${encodeURIComponent(modulo || '')}`).catch(() => null);
    if (r?.valor) {
      alvo = r.valor;
      await chrome.storage.local.set({ ultimaPlaylist: alvo });
    }
  }
  return { playlists, alvo: alvo && valores.has(alvo) ? alvo : null };
}

/** "id|subpasta" → a playlist e o módulo (subpasta vazia = a raiz da playlist). */
export const separar = (valor: string) => {
  const [id, modulo] = (valor || '|').split('|');
  return { id, modulo: modulo || null };
};

// O nome da aula. Primeiro os lugares conhecidos de plataformas de curso (no
// Ferretto, o título da aula fica num <span class="font-family-headlines">);
// depois o título grande da página (h1/h2); por último o da aba, que vem com o
// nome do site junto.
const SELETORES_DE_TITULO = ['span.font-family-headlines', 'h1', 'h2'];

export async function tituloDaAula(aba: chrome.tabs.Tab): Promise<string> {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: aba.id! },
      args: [SELETORES_DE_TITULO],
      // Roda na página: só pode usar o que vem pelos args.
      func: (seletores: string[]) => {
        for (const s of seletores) {
          const t = [...document.querySelectorAll<HTMLElement>(s)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).find((x) => x && x.length < 150);
          if (t) return t;
        }
        return document.title;
      },
    });
    if (r?.result) return r.result;
  } catch {
    /* página do navegador, sem permissão */
  }
  return aba.title ?? '';
}

/** Os textos que o seletor acha na página (null: seletor inválido). */
export async function textosDoSeletor(tabId: number, seletor: string): Promise<string[] | null> {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [seletor],
    func: (sel: string) => {
      try {
        return [...document.querySelectorAll<HTMLElement>(sel)].map((e) => e.innerText.replace(/\s+/g, ' ').trim());
      } catch {
        return null;
      }
    },
  });
  return r?.result ?? null;
}
