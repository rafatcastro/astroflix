import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../db/index';
import { createCourseFromPath } from '../scan/scan-course';
import { buildExport } from './export';
import { applyImport } from './import';
import type { LibraryExport } from './format';

// Ids de coleção e o carimbo de hora são gerados por máquina: o que precisa
// sobreviver à ida e volta é o SIGNIFICADO, não os identificadores. Trocar o id
// da coleção pelo nome dela é o que torna a comparação honesta.
function porSignificado(e: LibraryExport) {
  const nomeDaColecao = new Map(e.collections.map((c) => [c.id, c.name]));
  return {
    ...e,
    exportedAt: '<hora>',
    collections: e.collections.map((c) => ({ ...c, id: '<id>' })),
    courses: e.courses.map((c) => ({
      ...c,
      collectionId: c.collectionId ? nomeDaColecao.get(c.collectionId) : null,
    })),
  };
}

describe('ida e volta', () => {
  it('exportar, importar num banco vazio e exportar de novo devolve o mesmo arquivo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ida-volta-'));
    fs.mkdirSync(path.join(root, 'Modulo 1'));
    fs.writeFileSync(path.join(root, 'Modulo 1', 'aula-01.mp4'), 'conteudo');
    fs.writeFileSync(path.join(root, 'Modulo 1', 'aula-02.mp4'), 'conteudo');
    fs.writeFileSync(path.join(root, 'apostila.pdf'), 'x');

    const origem = openDb(':memory:');
    const courseId = createCourseFromPath(origem, root);
    const aulas = origem.prepare('SELECT id FROM lessons WHERE course_id=? ORDER BY order_index').all(courseId) as any[];
    origem
      .prepare(
        `INSERT INTO progress (lesson_id, position_sec, furthest_sec, duration_sec, completed, completed_at, auto_completed, updated_at)
         VALUES (?, 120, 200, 612.4, 0, NULL, 0, ?), (?, 300, 612.4, 612.4, 1, ?, 1, ?)`,
      )
      .run(
        aulas[0].id,
        '2026-03-01T00:00:00.000Z',
        aulas[1].id,
        '2026-02-01T00:00:00.000Z',
        '2026-02-01T00:00:00.000Z',
      );
    origem.prepare("INSERT INTO collections (id, name, created_at, sort_index) VALUES ('c1','Programação',?,0)").run(
      '2026-01-01T00:00:00.000Z',
    );
    origem.prepare("UPDATE courses SET collection_id='c1', poster_lesson_id=?, sort_index=2 WHERE id=?").run(
      aulas[1].id,
      courseId,
    );
    origem.prepare("INSERT INTO course_roots (id, path, created_at, last_checked_at) VALUES ('r1',?,?,NULL)").run(
      path.dirname(root),
      '2026-01-01T00:00:00.000Z',
    );
    origem.prepare("INSERT INTO settings (key, value) VALUES ('allowed_roots_extra', ?)").run('["/Volumes/Cursos"]');

    const primeiro = buildExport(origem, '1.0.0');

    const destino = openDb(':memory:');
    applyImport(destino, primeiro);
    const segundo = buildExport(destino, '1.0.0');

    expect(porSignificado(segundo)).toEqual(porSignificado(primeiro));

    fs.rmSync(root, { recursive: true, force: true });
    origem.close();
    destino.close();
  });

  it('curso do Drive volta do mesmo jeito quando existe nos dois lados', () => {
    const origem = openDb(':memory:');
    origem
      .prepare(
        `INSERT INTO courses (id, title, root_path, structure, archived, created_at, updated_at, source, drive_folder_id, drive_resource_key)
         VALUES ('d1', 'Drive', 'https://drive.google.com/drive/folders/ABC', 'flat', 0, 'x', 'x', 'drive', 'ABC', 'rk')`,
      )
      .run();
    const arquivo = buildExport(origem, '1.0.0');

    const destino = openDb(':memory:');
    applyImport(destino, arquivo);

    // Sem o curso aqui, nada é criado: o link do Drive não vira curso nem raiz.
    expect(buildExport(destino, '1.0.0').courses).toEqual([]);
    origem.close();
    destino.close();
  });
});

describe('flashcards no backup', () => {
  it('vão e voltam presos à aula, sem duplicar ao importar de novo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
    fs.writeFileSync(path.join(root, 'aula-01.mp4'), 'x');
    const origem = openDb(':memory:');
    const courseId = createCourseFromPath(origem, root);
    const aula = origem.prepare('SELECT id FROM lessons WHERE course_id=?').get(courseId) as { id: string };
    const card = origem.prepare(
      `INSERT INTO flashcards (id, course_id, lesson_id, minuto_sec, frente, verso, anki_note_id, pendente, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'x', 'x')`,
    );
    card.run('f1', courseId, aula.id, 42, 'Frente', 'Verso', 1001, null);
    card.run('f2', null, null, null, 'Geral', 'V', null, 'criar');
    card.run('f3', null, null, null, 'Apagado', 'V', 1002, 'apagar');

    const arquivo = buildExport(origem);
    expect(arquivo.courses[0].flashcards).toEqual([
      { lessonRelPath: 'aula-01.mp4', minutoSec: 42, frente: 'Frente', verso: 'Verso', ankiNoteId: 1001, criadoEm: 'x' },
    ]);
    expect(arquivo.flashcardsGerais?.map((f) => f.frente)).toEqual(['Geral']);

    const destino = openDb(':memory:');
    applyImport(destino, arquivo);
    applyImport(destino, arquivo);
    const linhas = destino
      .prepare('SELECT f.frente, f.minuto_sec, f.anki_note_id, f.pendente, l.rel_path FROM flashcards f LEFT JOIN lessons l ON l.id = f.lesson_id ORDER BY f.frente')
      .all();
    expect(linhas).toEqual([
      { frente: 'Frente', minuto_sec: 42, anki_note_id: 1001, pendente: null, rel_path: 'aula-01.mp4' },
      { frente: 'Geral', minuto_sec: null, anki_note_id: null, pendente: 'criar', rel_path: null },
    ]);
  });
});
