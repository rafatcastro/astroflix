import { spawn, spawnSync } from 'node:child_process';

export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(release);
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}

const extractLimit = createLimiter(3);

let ffmpegCache: boolean | null = null;
function binWorks(name: string): boolean {
  try {
    return spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}
export function hasFfmpeg(): boolean {
  if (ffmpegCache === null) ffmpegCache = binWorks('ffmpeg') && binWorks('ffprobe');
  return ffmpegCache;
}

export function probeDurationSec(videoPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath]);
    let out = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.on('error', () => resolve(null));
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

export interface MediaFormat {
  formatName: string;
  videoCodec: string | null;
  profile: string | null;
  pixFmt: string | null;
  /** codec_tag_string do vídeo: o WebKit só toca HEVC marcado como hvc1, não hev1. */
  codecTag: string | null;
  audioCodec: string | null;
}

/** O que o player da janela decodifica além do básico (H.264 8-bit), perguntado ao próprio <video>. */
export interface Capacidades {
  hevc: boolean;
}

// Formato REAL do arquivo (o container/codec de dentro, não a extensão — que mente:
// cursos baixados vêm como MPEG-TS renomeado p/ .mp4, ou H.264 10-bit).
export function probeFormat(videoPath: string): Promise<MediaFormat | null> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name',
      '-show_entries', 'stream=codec_type,codec_name,profile,pix_fmt,codec_tag_string',
      '-of', 'json',
      videoPath,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.on('error', () => resolve(null));
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const j = JSON.parse(out);
        const streams: any[] = j.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');
        resolve({
          formatName: String(j.format?.format_name ?? ''),
          videoCodec: video?.codec_name ?? null,
          profile: video?.profile ?? null,
          pixFmt: video?.pix_fmt ?? null,
          codecTag: video?.codec_tag_string ?? null,
          audioCodec: audio?.codec_name ?? null,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

export type Playback = { playable: true } | { playable: false; reason: 'container' | 'codec'; remuxable: boolean };

// Reproduzibilidade REAL no <video> da janela. Regras guiadas pelos casos do acervo:
// - MPEG-TS (mesmo com .mp4 na extensão): o player não demuxa TS. Se os codecs
//   de dentro ele toca, um remux -c copy (sem recodificar) resolve.
// - H.264 além de 8-bit 4:2:0 (High 10/4:2:2/4:4:4): ninguém decodifica; só
//   recodificando.
// - HEVC/H.265: depende do player. A janela do macOS (WebKit) toca, desde que o
//   vídeo venha marcado como hvc1 (hev1 precisa só de um remux trocando a marca);
//   a do Windows só com a extensão HEVC instalada. Por isso quem diz é `cap`, que a
//   interface pergunta ao próprio <video> em vez de supor o pior.
const AUDIO_EM_MP4 = new Set(['aac', 'mp3']);

export function classifyPlayback(fmt: MediaFormat, cap: Capacidades = { hevc: false }): Playback {
  const hevc = fmt.videoCodec === 'hevc' || fmt.videoCodec === 'h265';
  const audioOk = fmt.audioCodec === null || AUDIO_EM_MP4.has(fmt.audioCodec);
  const videoOk = (fmt.videoCodec === 'h264' && !h264AlemDe8Bit(fmt)) || (hevc && cap.hevc);
  if (fmt.formatName.includes('mpegts')) {
    return { playable: false, reason: 'container', remuxable: videoOk && audioOk };
  }
  if (hevc) {
    if (!cap.hevc) return { playable: false, reason: 'codec', remuxable: false };
    if ((fmt.codecTag ?? '').toLowerCase() !== 'hvc1') return { playable: false, reason: 'container', remuxable: audioOk };
    return { playable: true };
  }
  if (fmt.videoCodec === 'h264' && h264AlemDe8Bit(fmt)) {
    return { playable: false, reason: 'codec', remuxable: false };
  }
  return { playable: true };
}

function h264AlemDe8Bit(fmt: MediaFormat): boolean {
  const p = (fmt.profile ?? '').toLowerCase();
  return p.includes('10') || p.includes('422') || p.includes('444') || /10le|12le|422|444/.test(fmt.pixFmt ?? '');
}

// Remux TS→MP4 sem recodificar (-c copy): rápido, zero perda. Pega a primeira
// trilha de vídeo e a primeira de áudio (TS dual-audio vira áudio único) e move
// o moov pro início (+faststart) para o navegador começar a tocar sem baixar tudo.
// HEVC sai marcado como hvc1, a única marca que o WebKit aceita.
export function remuxToMp4(inPath: string, outPath: string, opts: { hevc?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c', 'copy',
      ...(opts.hevc ? ['-tag:v', 'hvc1'] : []),
      '-movflags', '+faststart',
      '-f', 'mp4',
      outPath,
    ];
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg remux saiu com código ${code}`))));
  });
}

// Recodifica para H.264 8-bit + AAC, o que toda janela toca. É o último recurso
// (lento e com alguma perda), para H.264 10-bit e para HEVC onde o player não o
// decodifica. `aoAvancar` recebe 0–1, lido do -progress do ffmpeg.
export function transcodeToMp4(
  inPath: string,
  outPath: string,
  duracaoSec: number | null,
  aoAvancar?: (fracao: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      '-f', 'mp4',
      outPath,
    ];
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let resto = '';
    p.stdout.on('data', (d) => {
      resto += String(d);
      const linhas = resto.split('\n');
      resto = linhas.pop() ?? '';
      for (const l of linhas) {
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m && duracaoSec && aoAvancar) aoAvancar(Math.min(1, Number(m[1]) / 1e6 / duracaoSec));
      }
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg transcode saiu com código ${code}`))));
  });
}

// Validação do convertido antes de servi-lo no lugar do original: precisa ser
// tocável de verdade E ter a mesma duração do original (±2s).
export async function validateConverted(
  originalPath: string,
  convertedPath: string,
  cap: Capacidades = { hevc: false },
): Promise<boolean> {
  const fmt = await probeFormat(convertedPath);
  if (!fmt || !classifyPlayback(fmt, cap).playable) return false;
  const [dOrig, dConv] = await Promise.all([probeDurationSec(originalPath), probeDurationSec(convertedPath)]);
  if (dOrig === null || dConv === null) return false;
  return Math.abs(dOrig - dConv) <= 2;
}

export function extractFrame(videoPath: string, atSec: number, outPath: string, width = 480): Promise<void> {
  return extractLimit(
    () =>
      new Promise<void>((resolve, reject) => {
        const args = ['-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-update', '1', '-vf', `scale='min(${width},iw)':-2`, '-y', outPath];
        const p = spawn('ffmpeg', args, { stdio: 'ignore' });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com código ${code}`))));
      }),
  );
}
