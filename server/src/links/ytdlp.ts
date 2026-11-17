import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

// O yt-dlp é o que sabe tirar o vídeo de uma página (YouTube, players de curso
// com HLS, milhares de sites). Ele entra como o ffmpeg: opcional, procurado no
// PATH (que o index.ts já completa com o Homebrew). Quem nunca importa por link
// nunca precisa dele.

let temCache = false;
/** Só o "sim" fica guardado: a pessoa pode instalar com o app aberto. */
export function temYtDlp(): boolean {
  if (temCache) return true;
  try {
    temCache = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', timeout: 15_000 }).status === 0;
  } catch {
    temCache = false;
  }
  return temCache;
}

export interface VideoAchado {
  url: string;
  titulo: string;
  duracaoSec: number | null;
}

export type ResultadoListar =
  | { tipo: 'playlist'; titulo: string | null; itens: VideoAchado[]; extrator: string }
  | { tipo: 'video'; video: VideoAchado; extrator: string };

const BASE = ['--no-warnings', '--ignore-config', '--no-color'];

function rodar(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ codigo: number | null; saida: string; erro: string }> {
  return new Promise((resolve) => {
    const p = spawn('yt-dlp', [...BASE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (erro += d));
    const parar = () => p.kill('SIGKILL');
    const t = setTimeout(parar, timeoutMs);
    signal?.addEventListener('abort', parar);
    p.on('error', () => resolve({ codigo: -1, saida, erro: erro || 'sem-ytdlp' }));
    p.on('close', (codigo) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', parar);
      resolve({ codigo, saida, erro });
    });
  });
}

const duracao = (d: unknown) => (typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d) : null);

/**
 * O que há num link, sem baixar: uma playlist (os vídeos dela, sem abrir cada
 * um) ou um vídeo só. `soUm` é para os links achados numa página: um vídeo do
 * YouTube aberto com `&list=` não traz a playlist inteira junto.
 */
export async function listar(
  url: string,
  opts: { referer?: string; soUm?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ResultadoListar | null> {
  const args = ['-J', '--flat-playlist'];
  if (opts.soUm) args.push('--no-playlist');
  if (opts.referer) args.push('--referer', opts.referer);
  const r = await rodar([...args, url], opts.timeoutMs ?? 60_000, opts.signal);
  if (r.codigo !== 0) return null;
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(r.saida) as Record<string, unknown>;
  } catch {
    return null;
  }
  const extrator = String(info.extractor_key ?? info.extractor ?? '');
  if (info._type === 'playlist') {
    const entradas = Array.isArray(info.entries) ? (info.entries as Array<Record<string, unknown>>) : [];
    const itens = entradas
      .map((e): VideoAchado | null => {
        const u = String(e.url ?? e.webpage_url ?? '');
        if (!/^https?:\/\//.test(u)) return null;
        return { url: u, titulo: String(e.title ?? '').trim() || u, duracaoSec: duracao(e.duration) };
      })
      .filter((v): v is VideoAchado => !!v);
    return { tipo: 'playlist', titulo: typeof info.title === 'string' ? info.title : null, itens, extrator };
  }
  return {
    tipo: 'video',
    video: { url: String(info.webpage_url ?? url), titulo: String(info.title ?? '').trim() || url, duracaoSec: duracao(info.duration) },
    extrator,
  };
}

/**
 * Baixa o vídeo para `pastaTemp/<nome>.<ext>` e devolve o caminho final. Pede
 * H.264 + AAC em MP4, o que a janela do app toca sem conversão.
 */
export function baixarVideo(
  url: string,
  pastaTemp: string,
  nome: string,
  opts: { referer?: string; signal?: AbortSignal; aoProgresso?: (pct: number) => void } = {},
): Promise<string> {
  fs.mkdirSync(pastaTemp, { recursive: true });
  const args = [
    ...BASE,
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-simulate',
    '--print',
    'after_move:filepath',
    '--progress-template',
    'download:BAIXANDO %(progress._percent_str)s',
    '-S',
    'vcodec:h264,res:1080,acodec:aac',
    '--merge-output-format',
    'mp4',
    '--remux-video',
    'mp4',
    '-o',
    `${pastaTemp}/${nome}.%(ext)s`,
  ];
  if (opts.referer) args.push('--referer', opts.referer);
  args.push(url);

  return new Promise((resolve, reject) => {
    const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let final: string | null = null;
    let erro = '';
    const linha = (l: string) => {
      const m = /BAIXANDO\s*([\d.]+)%/.exec(l);
      if (m) return opts.aoProgresso?.(Number(m[1]));
      const t = l.trim();
      if (t && fs.existsSync(t)) final = t;
    };
    const ler = (s: NodeJS.ReadableStream, guardar: boolean) => {
      let resto = '';
      s.on('data', (d: Buffer) => {
        const partes = (resto + d.toString()).split(/\r?\n|\r/);
        resto = partes.pop() ?? '';
        for (const l of partes) {
          if (guardar && !l.includes('BAIXANDO')) erro = (erro + l + '\n').slice(-2000);
          linha(l);
        }
      });
      s.on('end', () => resto && linha(resto));
    };
    ler(p.stdout, false);
    ler(p.stderr, true);
    const parar = () => p.kill('SIGKILL');
    opts.signal?.addEventListener('abort', parar);
    p.on('error', () => reject(new Error('sem-ytdlp')));
    p.on('close', (codigo) => {
      opts.signal?.removeEventListener('abort', parar);
      if (opts.signal?.aborted) return reject(new Error('cancelado'));
      if (codigo === 0 && final) return resolve(final);
      reject(new Error(erro.split('\n').filter((l) => l.includes('ERROR')).pop()?.trim() || 'falhou'));
    });
  });
}
