import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { createLimiter, hasFfmpeg, probeDurationSec, extractFrame } from './ffmpeg';
import { arquivoBaixado } from '../armazenamento';
import { arquivoEmCache } from '../cache-aulas';
import { arquivoDoCurso } from '../routes/fs';
import type { ServicosDrive } from '../drive/servicos';
import type { ServicosTelegram } from '../telegram/servicos';
import type { PeerTelegram } from '../telegram/tipos';
import { resourceKeyDoCurso } from '../drive/status';
import { baixarImagemDoGoogle } from '../scan/scan-drive';

export function pickFrameTimestamp(durationSec: number | null): number {
  if (durationSec && durationSec > 0) return Math.max(1, durationSec * 0.1);
  return 5;
}

// JPEG (encoder mjpeg) é universal em qualquer build de ffmpeg; o encoder WebP
// nem sempre está compilado (ex.: o ffmpeg do Homebrew sem libwebp), então
// usamos .jpg para portabilidade.
export function lessonThumbPath(config: AppConfig, lessonId: string, mtime: number): string {
  return path.join(config.thumbsDir, `${lessonId}-${mtime}.jpg`);
}

export function courseCoverPath(config: AppConfig, courseId: string): string {
  return path.join(config.thumbsDir, `course-${courseId}.jpg`);
}


// Escreve em arquivo temporário na mesma pasta e renomeia: duas gravações da
// mesma capa (segundo plano + sob demanda) ou uma leitura no meio nunca veem
// um JPEG pela metade.
export function gravarCapaAtomico(destino: string, bytes: Buffer): void {
  mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, destino);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// A capa da aula sai, nesta ordem, do que custa menos: um arquivo no disco (aula
// local, baixada ou no cache) com o ffmpeg; a miniatura que a origem guarda
// (Drive, Telegram); e, se a origem não tiver, um quadro lido do próprio stream do
// app pelo ffmpeg. Quem chama é só a fila (fila-capas.ts): as rotas respondem com
// o que está no disco e nunca esperam isto.

/** A capa já gravada desta aula, ou null. Síncrona: a rota responde na hora. */
export function capaNoDisco(db: Db, config: AppConfig, lessonId: string): string | null {
  const row = db.prepare('SELECT mtime, thumb_path, playable, missing FROM lessons WHERE id=?').get(lessonId) as
    | { mtime: number; thumb_path: string | null; playable: number; missing: number }
    | undefined;
  if (!row || row.missing) return null;
  const out = lessonThumbPath(config, lessonId, row.mtime);
  if (!existsSync(out)) return null;
  if (row.thumb_path !== out) db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?').run(out, lessonId);
  return out;
}

export type ResultadoCapa = 'ok' | 'sem-capa' | 'sem-ffmpeg' | 'rede';

export interface DepsCapa {
  db: Db;
  config: AppConfig;
  drive?: ServicosDrive;
  telegram?: ServicosTelegram;
  /** A porta em que o servidor escuta (o ffmpeg lê o stream por ela); null antes de escutar. */
  porta: () => number | null;
  /** Espera não haver vídeo remoto tocando, para o ffmpeg não disputar a banda com a aula. */
  esperarSemVideo: () => Promise<void>;
}

// Rede para a origem: o Drive aguenta algumas ao mesmo tempo; o Telegram, uma (limite de flood).
const limiteDrive = createLimiter(3);
const limiteTelegram = createLimiter(1);
// O ffmpeg lendo pela rede: uma por vez, em qualquer origem.
const limiteFfmpegRemoto = createLimiter(1);

const gravar = (db: Db, lessonId: string, out: string) => db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?').run(out, lessonId);

/** Os bytes da miniatura da origem; null = a origem não tem; lança = falha de rede. */
async function miniaturaDaOrigem(deps: DepsCapa, row: any): Promise<Buffer | null> {
  if (row.source === 'drive') {
    if (!deps.drive || !row.remote_id) return null;
    const ing = deps.drive.ingestao(resourceKeyDoCurso(row.drive_folder_id, row.drive_resource_key));
    return limiteDrive(async () => {
      // O thumbnailLink guardado expira: pede um novo ao Drive em vez de reusá-lo.
      const arquivo = await ing.cliente.getArquivo(row.remote_id);
      if (!arquivo.thumbnailLink) return null;
      const bytes = await baixarImagemDoGoogle(ing, arquivo.thumbnailLink);
      // Tinha link e a imagem não veio: rede ou link expirado, vale tentar de novo logo.
      if (!bytes) throw new Error('rede');
      return bytes;
    });
  }
  if (row.source === 'telegram') {
    if (!deps.telegram || !row.remote_id || !row.telegram_peer) return null;
    const telegram = deps.telegram;
    return limiteTelegram(async () => {
      const cliente = await telegram.cliente();
      return cliente.miniatura(JSON.parse(row.telegram_peer) as PeerTelegram, Number(row.remote_id));
    });
  }
  return null;
}

export async function gerarCapa(deps: DepsCapa, lessonId: string): Promise<ResultadoCapa> {
  const { db, config } = deps;
  const row = db
    .prepare(
      `SELECT l.rel_path, l.mtime, l.playable, l.missing, l.duration_sec, l.remote_id, c.root_path, c.source, c.drive_folder_id, c.drive_resource_key, c.telegram_peer
       FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`,
    )
    .get(lessonId) as any;
  if (!row || row.missing) return 'sem-capa';
  const out = lessonThumbPath(config, lessonId, row.mtime);
  if (existsSync(out)) {
    gravar(db, lessonId, out);
    return 'ok';
  }
  const remota = row.source === 'drive' || row.source === 'telegram';

  // 1. Arquivo no disco: sem rede nenhuma.
  const local = remota
    ? (arquivoBaixado(db, config, 'aula', lessonId)?.arquivo ?? arquivoEmCache(db, lessonId)?.arquivo ?? null)
    : arquivoDoCurso(row.root_path, row.rel_path);
  if (local && existsSync(local) && hasFfmpeg()) {
    let duration = row.duration_sec as number | null;
    if (duration == null) {
      duration = await probeDurationSec(local);
      if (duration != null) db.prepare('UPDATE lessons SET duration_sec=? WHERE id=?').run(duration, lessonId);
    }
    try {
      await extractFrame(local, pickFrameTimestamp(duration), out);
      gravar(db, lessonId, out);
      return 'ok';
    } catch {
      if (!remota) return 'sem-capa';
    }
  }
  if (!remota) return hasFfmpeg() ? 'sem-capa' : 'sem-ffmpeg';

  // 2. A miniatura que a origem guarda.
  let bytes: Buffer | null;
  try {
    bytes = await miniaturaDaOrigem(deps, row);
  } catch {
    return 'rede';
  }
  if (bytes) {
    gravarCapaAtomico(out, bytes);
    gravar(db, lessonId, out);
    return 'ok';
  }

  // 3. A origem não tem: um quadro do próprio stream, lendo só o pedaço necessário.
  if (!hasFfmpeg()) return 'sem-ffmpeg';
  const porta = deps.porta();
  if (!porta) return 'rede';
  return limiteFfmpegRemoto(async () => {
    await deps.esperarSemVideo();
    try {
      await extractFrame(`http://127.0.0.1:${porta}/api/lessons/${lessonId}/stream`, pickFrameTimestamp(row.duration_sec), out, {
        timeoutMs: 30_000,
        // A rota de stream não conta esta leitura como "vídeo tocando" (senão a fila esperaria a si mesma).
        headers: `${CABECALHO_CAPA}: 1\r\n`,
      });
    } catch (e) {
      return (e as Error).message === 'timeout' ? 'rede' : 'sem-capa';
    }
    if (!existsSync(out)) return 'sem-capa';
    gravar(db, lessonId, out);
    return 'ok';
  });
}

/** Marca a leitura do stream feita pelo ffmpeg das capas. */
export const CABECALHO_CAPA = 'x-astroflix-capa';

const NOME_DA_CAPA = /^([0-9a-f-]{36})-(\d+)\.jpg$/i;

/**
 * Uma vez ao abrir: tira de thumbs/ o que ficou sem dono. O `.tmp` de uma gravação
 * interrompida, a capa de aula que não existe mais e a capa antiga de um arquivo
 * reenviado (o mtime novo deu outro nome). Capa de curso e de PDF nunca entram.
 */
export function varrerCapas(db: Db, config: AppConfig): void {
  let nomes: string[];
  try {
    nomes = readdirSync(config.thumbsDir);
  } catch {
    return;
  }
  const mtimeDe = db.prepare('SELECT mtime FROM lessons WHERE id=?');
  for (const nome of nomes) {
    if (nome.endsWith('.tmp')) {
      rmSync(path.join(config.thumbsDir, nome), { force: true });
      continue;
    }
    const m = NOME_DA_CAPA.exec(nome);
    if (!m) continue;
    const aula = mtimeDe.get(m[1]) as { mtime: number } | undefined;
    if (!aula || String(aula.mtime) !== m[2]) rmSync(path.join(config.thumbsDir, nome), { force: true });
  }
}

export async function setCourseCover(
  db: Db,
  config: AppConfig,
  courseId: string,
  lessonId: string,
  atSec: number,
): Promise<'ok' | 'not_found' | 'no_ffmpeg'> {
  const row = db
    .prepare(`SELECT l.rel_path, c.root_path FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND l.course_id = ?`)
    .get(lessonId, courseId) as any;
  if (!row) return 'not_found';
  if (!hasFfmpeg()) return 'no_ffmpeg';
  const videoPath = arquivoDoCurso(row.root_path, row.rel_path);
  if (!videoPath) return 'not_found';
  const out = courseCoverPath(config, courseId);
  await extractFrame(videoPath, Math.max(0, atSec), out);
  db.prepare('UPDATE courses SET cover_path=? WHERE id=?').run(out, courseId);
  return 'ok';
}
