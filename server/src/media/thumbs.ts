import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { hasFfmpeg, probeDurationSec, extractFrame } from './ffmpeg';
import { arquivoDoCurso } from '../routes/fs';
import type { ServicosDrive } from '../drive/servicos';
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


// Duas requisições da mesma capa (estante + página do curso) não baixam duas vezes.
const capasDriveEmAndamento = new Map<string, Promise<string | null>>();

async function capaDoDrive(db: Db, drive: ServicosDrive, row: any, lessonId: string, out: string): Promise<string | null> {
  try {
    const deps = drive.ingestao(resourceKeyDoCurso(row.drive_folder_id, row.drive_resource_key));
    // O thumbnailLink guardado expira: pede um novo ao Drive em vez de reusá-lo.
    const arquivo = await deps.cliente.getArquivo(row.remote_id);
    if (!arquivo.thumbnailLink) return null;
    const bytes = await baixarImagemDoGoogle(deps, arquivo.thumbnailLink);
    if (!bytes) return null;
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?').run(out, lessonId);
    return out;
  } catch {
    // Capa é enfeite: qualquer falha (offline, sem acesso) vira placeholder.
    return null;
  }
}

export async function getOrCreateLessonThumb(
  db: Db,
  config: AppConfig,
  lessonId: string,
  drive?: ServicosDrive,
): Promise<string | null> {
  const row = db
    .prepare(
      `SELECT l.rel_path, l.mtime, l.playable, l.missing, l.duration_sec, l.remote_id, c.root_path, c.source, c.drive_folder_id, c.drive_resource_key
       FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`,
    )
    .get(lessonId) as any;
  if (!row || !row.playable || row.missing) return null;

  const out = lessonThumbPath(config, lessonId, row.mtime);
  if (existsSync(out)) {
    db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?').run(out, lessonId);
    return out;
  }
  // Sem arquivo local no curso do Drive: nunca ffmpeg; a capa vem do Drive.
  if (row.source === 'drive') {
    if (!drive || !row.remote_id) return null;
    let p = capasDriveEmAndamento.get(lessonId);
    if (!p) {
      p = capaDoDrive(db, drive, row, lessonId, out).finally(() => capasDriveEmAndamento.delete(lessonId));
      capasDriveEmAndamento.set(lessonId, p);
    }
    return p;
  }
  if (!hasFfmpeg()) return null;

  const videoPath = arquivoDoCurso(row.root_path, row.rel_path);
  if (!videoPath || !existsSync(videoPath)) return null;

  let duration = row.duration_sec as number | null;
  if (duration == null) {
    duration = await probeDurationSec(videoPath);
    if (duration != null) db.prepare('UPDATE lessons SET duration_sec=? WHERE id=?').run(duration, lessonId);
  }
  try {
    await extractFrame(videoPath, pickFrameTimestamp(duration), out);
  } catch {
    return null;
  }
  db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?').run(out, lessonId);
  return out;
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
