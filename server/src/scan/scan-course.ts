import { transaction, type Db } from '../db';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { walkCourseDir } from './walk';
import { deriveCourse, type DerivedCourse, type ScannedFile } from './derive';
import type { MaterialKind } from './walk';

export interface OrigemCurso {
  title: string;
  rootPath: string;
  source: 'local' | 'drive';
  driveFolderId?: string;
  driveResourceKey?: string | null;
}

export interface ExtraRemoto {
  remoteId: string;
  durationSec: number | null;
}

// Ponto único de inserção: curso local e curso do Drive entram pela mesma
// transação, para a estrutura (módulos, capa = 1ª aula) nunca divergir entre
// as duas origens. `extras` é indexado por relPath, que é a identidade da aula.
export function inserirCursoDerivado(
  db: Db,
  origem: OrigemCurso,
  derived: DerivedCourse,
  materials: Array<ScannedFile & { kind: MaterialKind }>,
  extras?: Map<string, ExtraRemoto>,
): string {
  const now = new Date().toISOString();
  const courseId = randomUUID();

  const insertCourse = db.prepare(`
    INSERT INTO courses (id, title, root_path, structure, archived, sort_index, poster_lesson_id, created_at, updated_at, last_scanned_at, source, drive_folder_id, drive_resource_key)
    VALUES (@id, @title, @root_path, @structure, 0, NULL, NULL, @now, @now, @now, @source, @drive_folder_id, @drive_resource_key)
  `);
  const insertLesson = db.prepare(`
    INSERT INTO lessons (id, course_id, rel_path, module, title, order_index, module_order, duration_sec, size_bytes, mtime, container, playable, thumb_path, missing, remote_id)
    VALUES (@id, @course_id, @rel_path, @module, @title, @order_index, @module_order, @duration_sec, @size_bytes, @mtime, @container, @playable, NULL, 0, @remote_id)
  `);
  const insertMaterial = db.prepare(`
    INSERT INTO materials (id, course_id, module, rel_path, kind, size_bytes, remote_id)
    VALUES (@id, @course_id, @module, @rel_path, @kind, @size_bytes, @remote_id)
  `);
  const updatePoster = db.prepare('UPDATE courses SET poster_lesson_id=? WHERE id=?');

  transaction(db, () => {
    insertCourse.run({
      id: courseId,
      title: origem.title,
      root_path: origem.rootPath,
      structure: derived.structure,
      now,
      source: origem.source,
      drive_folder_id: origem.driveFolderId ?? null,
      drive_resource_key: origem.driveResourceKey ?? null,
    });
    let firstLessonId: string | null = null;
    for (const lesson of derived.lessons) {
      const id = randomUUID();
      if (!firstLessonId) firstLessonId = id;
      const extra = extras?.get(lesson.relPath);
      insertLesson.run({
        id,
        course_id: courseId,
        rel_path: lesson.relPath,
        module: lesson.module,
        title: lesson.title,
        order_index: lesson.orderIndex,
        module_order: lesson.moduleOrder,
        duration_sec: extra?.durationSec ?? null,
        size_bytes: lesson.sizeBytes,
        mtime: lesson.mtime,
        container: lesson.container,
        playable: lesson.playable ? 1 : 0,
        remote_id: extra?.remoteId ?? null,
      });
    }
    for (const material of materials) {
      const segs = material.relPath.split('/');
      insertMaterial.run({
        id: randomUUID(),
        course_id: courseId,
        module: segs.length > 1 ? segs[0] : null,
        rel_path: material.relPath,
        kind: material.kind,
        size_bytes: material.sizeBytes,
        remote_id: extras?.get(material.relPath)?.remoteId ?? null,
      });
    }
    if (firstLessonId) {
      updatePoster.run(firstLessonId, courseId);
    }
  });

  return courseId;
}

// onUnreadable recebe os caminhos que a listagem mostrou mas o sistema de
// arquivos não entregou (ver walkCourseDir). É opcional de propósito: quem só
// quer criar o curso não precisa saber; quem importa em lote precisa contar ao
// usuário o que ficou de fora.
export function createCourseFromPath(
  db: Db,
  rootPath: string,
  onUnreadable?: (caminhos: string[]) => void,
): string {
  const { videos, materials, unreadable } = walkCourseDir(rootPath);
  if (unreadable.length) onUnreadable?.(unreadable);
  const derived = deriveCourse(videos);
  return inserirCursoDerivado(
    db,
    { title: path.basename(rootPath), rootPath, source: 'local' },
    derived,
    materials,
  );
}
