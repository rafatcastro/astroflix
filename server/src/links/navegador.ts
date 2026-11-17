import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Cabecalho } from './pagina';

// Página de curso costuma ser montada por JavaScript: o HTML cru que o fetch
// recebe não tem a lista de aulas nem o player. Aqui a página abre num Chrome
// invisível (o da pessoa: Chrome, Edge, Brave ou Chromium), espera a rede
// assentar e a página parar de mudar, e devolve o HTML pronto e os vídeos que o
// player pediu pela rede (os .m3u8 que nunca aparecem no HTML). Fala com ele pelo
// protocolo do DevTools, sem dependência nova. Sem navegador instalado, quem
// chama continua com o fetch.

const CANDIDATOS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser'],
};

export function acharNavegador(): string | null {
  for (const c of CANDIDATOS[process.platform] ?? []) if (c && fs.existsSync(c)) return c;
  return null;
}

const MIDIA = /\.(m3u8|mpd|mp4|m4v|webm)(\?|$)/i;

export interface PaginaRenderizada {
  html: string;
  url: string;
  status: number | null;
  /** Os vídeos que a página pediu pela rede (o player carregando o .m3u8). */
  midias: string[];
  /** Quanto esperou, em ms, para o log. */
  esperou: number;
}

export interface Navegador {
  renderizar(
    url: string,
    opts: {
      login?: Cabecalho | null;
      loginPara?: (url: string) => boolean;
      referer?: string;
      maxMs?: number;
      signal?: AbortSignal;
      /** Para assim que o player pedir um vídeo (renovar um endereço assinado, que vence). */
      pararNoVideo?: boolean;
    },
  ): Promise<PaginaRenderizada>;
  fechar(): void;
}

type Mensagem = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

/** Sobe um Chrome invisível com um perfil temporário (nada da pessoa é lido nem mexido). */
export async function abrirNavegador(executavel: string, signal?: AbortSignal): Promise<Navegador> {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'astroflix-nav-'));
  const proc: ChildProcess = spawn(
    executavel,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--remote-debugging-port=0',
      `--user-data-dir=${perfil}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const fechar = () => {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* já saiu */
    }
    setTimeout(() => fs.rmSync(perfil, { recursive: true, force: true }), 1000).unref();
  };
  signal?.addEventListener('abort', fechar);

  const endereco = await new Promise<string>((resolve, reject) => {
    let erro = '';
    const t = setTimeout(() => reject(new Error('o navegador não abriu em 20 s')), 20_000);
    proc.stderr!.on('data', (d: Buffer) => {
      erro += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(erro);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    proc.on('exit', (c) => {
      clearTimeout(t);
      reject(new Error(`o navegador saiu (${c}): ${erro.slice(-300)}`));
    });
  }).catch((e) => {
    fechar();
    throw e;
  });

  const ws = new WebSocket(endereco);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('sem conexão com o navegador')), { once: true });
  }).catch((e) => {
    fechar();
    throw e;
  });

  let proximoId = 1;
  const pendentes = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  const ouvintes = new Set<(m: Mensagem) => void>();
  ws.addEventListener('message', (ev) => {
    let m: Mensagem;
    try {
      m = JSON.parse(String(ev.data)) as Mensagem;
    } catch {
      return;
    }
    if (m.id && pendentes.has(m.id)) {
      const p = pendentes.get(m.id)!;
      pendentes.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
      return;
    }
    for (const o of ouvintes) o(m);
  });
  const enviar = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = proximoId++;
      pendentes.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  // Sem "HeadlessChrome" no User-Agent: há site que recusa navegador sem tela.
  const versao = await enviar('Browser.getVersion').catch(() => null);
  const ua = typeof versao?.userAgent === 'string' ? versao.userAgent.replace('HeadlessChrome', 'Chrome') : null;

  return {
    async renderizar(url, opts) {
      const inicio = Date.now();
      const maxMs = opts.maxMs ?? 30_000;
      const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
      const s = (method: string, params: object = {}) => enviar(method, params, sessionId);

      const midias = new Set<string>();
      let emVoo = 0;
      let ultimaAtividade = Date.now();
      let status: number | null = null;
      let carregou = false;
      const ouvinte = (m: Mensagem) => {
        if (m.sessionId !== sessionId) return;
        const p = m.params;
        switch (m.method) {
          case 'Network.requestWillBeSent':
            emVoo++;
            ultimaAtividade = Date.now();
            if (MIDIA.test(p.request.url) && /^https?:/.test(p.request.url)) midias.add(p.request.url);
            break;
          case 'Network.loadingFinished':
          case 'Network.loadingFailed':
            emVoo = Math.max(0, emVoo - 1);
            ultimaAtividade = Date.now();
            break;
          case 'Network.responseReceived':
            if (p.type === 'Document' && status === null) status = p.response.status;
            if (/mpegurl|dash\+xml|^video\//i.test(p.response.mimeType ?? '') && /^https?:/.test(p.response.url)) midias.add(p.response.url);
            break;
          case 'Page.loadEventFired':
            carregou = true;
            break;
          case 'Fetch.requestPaused': {
            // O login vai pedido a pedido, só para o site do link e o player dele.
            const headers = Object.entries(p.request.headers as Record<string, string>)
              .filter(([n]) => !opts.login || n.toLowerCase() !== opts.login.nome.toLowerCase())
              .map(([name, value]) => ({ name, value }));
            if (opts.login && opts.loginPara?.(p.request.url)) headers.push({ name: opts.login.nome, value: opts.login.valor });
            void s('Fetch.continueRequest', { requestId: p.requestId, headers }).catch(() => undefined);
            break;
          }
        }
      };
      ouvintes.add(ouvinte);
      try {
        await s('Network.enable');
        await s('Page.enable');
        if (ua) await s('Network.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8' });
        if (opts.login) await s('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
        await s('Page.navigate', { url, ...(opts.referer ? { referrer: opts.referer } : {}) });

        // Espera: o load, a rede quieta por 1,5 s e a página com o mesmo número de
        // links em duas olhadas seguidas (listas que vão chegando aos poucos).
        const esgotou = () => Date.now() - inicio > maxMs || opts.signal?.aborted;
        const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
        while (!carregou && !esgotou() && !(opts.pararNoVideo && midias.size)) await dormir(200);
        let antes = -1;
        let iguais = 0;
        while (!esgotou() && !(opts.pararNoVideo && midias.size)) {
          await dormir(1000);
          const quieta = emVoo === 0 || Date.now() - ultimaAtividade > 3000;
          const r = await s('Runtime.evaluate', { expression: 'document.querySelectorAll("a,iframe,video").length', returnByValue: true }).catch(() => null);
          const n = Number(r?.result?.value ?? 0);
          iguais = n === antes ? iguais + 1 : 0;
          antes = n;
          if (quieta && iguais >= 2 && Date.now() - ultimaAtividade > 1500) break;
        }
        const r = await s('Runtime.evaluate', {
          expression: 'JSON.stringify({ html: document.documentElement.outerHTML, url: location.href })',
          returnByValue: true,
        });
        const { html, url: final } = JSON.parse(String(r?.result?.value ?? '{}')) as { html?: string; url?: string };
        return { html: (html ?? '').slice(0, 5_000_000), url: final || url, status, midias: [...midias], esperou: Date.now() - inicio };
      } finally {
        ouvintes.delete(ouvinte);
        await enviar('Target.closeTarget', { targetId }).catch(() => undefined);
      }
    },
    fechar() {
      try {
        ws.close();
      } catch {
        /* já fechou */
      }
      fechar();
    },
  };
}
