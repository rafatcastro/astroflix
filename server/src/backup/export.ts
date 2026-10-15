import type { Db } from '../db';
import { getAllowedRootsExtra } from '../routes/settings';
import {
  FORMAT,
  VERSION,
  type ExportedCollection,
  type ExportedCourseRoot,
  type ExportedFlashcard,
  type ExportedLesson,
  type LibraryExport,
} from './format';

// Monta o arquivo de export a partir do banco. Só leitura — nada aqui altera nada.
//
// A versão do app entra por parâmetro em vez de ser lida daqui: ler o
// package.json a partir do cwd amarra o export ao diretório de onde o processo
// subiu, e é exatamente o tipo de coisa que quebra num executável empacotado.
export function buildExport(db: Db, appVersion = 'dev'): LibraryExport {
  const collections = (
    db.prepare('SELECT id, name, created_at, sort_index FROM collections ORDER BY sort_index, rowid').all() as any[]
  ).map(
    (c): ExportedCollection => ({ id: c.id, name: c.name, createdAt: c.created_at, sortIndex: c.sort_index }),
  );

  const courses = db
    .prepare(
      `SELECT c.id, c.title, c.root_path, c.structure, c.archived, c.sort_index, c.collection_id,
              c.source, c.drive_folder_id, c.drive_resource_key, c.telegram_peer,
              (SELECT rel_path FROM lessons WHERE id = c.poster_lesson_id) AS poster_rel_path
       FROM courses c ORDER BY c.rowid`,
    )
    .all() as any[];

  const lessonsDoCurso = db.prepare(`
    SELECT l.rel_path, l.module, l.title, l.order_index, l.module_order, l.duration_sec,
           p.position_sec, p.furthest_sec, p.duration_sec AS p_duration_sec,
           p.completed, p.completed_at, p.auto_completed, p.updated_at
    FROM lessons l
    LEFT JOIN progress p ON p.lesson_id = l.id
    WHERE l.course_id = ?
    ORDER BY l.order_index
  `);

  // Card que a pessoa apagou e só espera o Anki confirmar já não existe para ela.
  const cardsDe = (where: string, ...args: string[]): ExportedFlashcard[] =>
    (
      db
        .prepare(
          `SELECT l.rel_path, f.minuto_sec, f.frente, f.verso, f.anki_note_id, f.criado_em
           FROM flashcards f LEFT JOIN lessons l ON l.id = f.lesson_id
           WHERE ${where} AND f.pendente IS NOT 'apagar' ORDER BY f.criado_em`,
        )
        .all(...args) as any[]
    ).map((f) => ({
      lessonRelPath: f.rel_path ?? null,
      minutoSec: f.minuto_sec,
      frente: f.frente,
      verso: f.verso,
      ankiNoteId: f.anki_note_id,
      criadoEm: f.criado_em,
    }));

  const courseRoots = (
    db.prepare('SELECT path, created_at, last_checked_at FROM course_roots ORDER BY rowid').all() as any[]
  ).map((r): ExportedCourseRoot => ({ path: r.path, createdAt: r.created_at, lastCheckedAt: r.last_checked_at }));

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    app: { version: appVersion, platform: process.platform },
    collections,
    courses: courses.map((c) => ({
      title: c.title,
      rootPath: c.root_path,
      structure: c.structure,
      archived: !!c.archived,
      sortIndex: c.sort_index,
      collectionId: c.collection_id,
      posterLessonRelPath: c.poster_rel_path ?? null,
      // Só curso do Drive carrega os campos: o arquivo de quem só tem cursos
      // locais fica idêntico ao de antes.
      ...(c.source === 'drive'
        ? {
            source: 'drive' as const,
            driveFolderId: c.drive_folder_id ?? undefined,
            driveResourceKey: c.drive_resource_key ?? undefined,
          }
        : c.source === 'telegram'
          ? { source: 'telegram' as const, telegramPeer: c.telegram_peer ?? undefined }
          : {}),
      // Só quem tem card leva o campo: o arquivo de quem não usa fica igual ao de antes.
      ...((cards) => (cards.length ? { flashcards: cards } : {}))(cardsDe('f.course_id = ?', c.id)),
      lessons: (lessonsDoCurso.all(c.id) as any[]).map(
        (l): ExportedLesson => ({
          relPath: l.rel_path,
          module: l.module,
          title: l.title,
          orderIndex: l.order_index,
          moduleOrder: l.module_order,
          durationSec: l.duration_sec,
          // updated_at nulo = LEFT JOIN sem linha de progresso: a aula nunca foi aberta.
          progress:
            l.updated_at === null
              ? null
              : {
                  positionSec: l.position_sec,
                  furthestSec: l.furthest_sec,
                  durationSec: l.p_duration_sec,
                  completed: !!l.completed,
                  completedAt: l.completed_at,
                  autoCompleted: !!l.auto_completed,
                  updatedAt: l.updated_at,
                },
        }),
      ),
    })),
    courseRoots,
    settings: { allowedRootsExtra: getAllowedRootsExtra(db) },
    ...((gerais) => (gerais.length ? { flashcardsGerais: gerais } : {}))(cardsDe('f.course_id IS NULL AND f.documento_id IS NULL')),
  };
}
