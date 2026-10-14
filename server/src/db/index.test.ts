import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDb, pragma, migrate } from './index';
import { SCHEMA_V1 } from './schema';

describe('openDb', () => {
  it('cria as tabelas e é idempotente', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(['collections', 'course_roots', 'courses', 'lessons', 'materials', 'progress', 'settings']),
    );
    expect(pragma(db, 'user_version')).toBe(6);
    const cols = db.prepare('PRAGMA table_info(courses)').all().map((r: any) => r.name);
    expect(cols).toContain('cover_path');
    expect(cols).toContain('collection_id');
    db.close();
  });

  it('excluir coleção mantém os cursos (collection_id vira NULL)', () => {
    const db = openDb(':memory:');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO collections (id, name, created_at) VALUES (?,?,?)').run('col1', 'Programação', now);
    db.prepare(
      "INSERT INTO courses (id, title, root_path, structure, archived, created_at, updated_at, collection_id) VALUES ('c1','X','/x','flat',0,?,?, 'col1')",
    ).run(now, now);
    db.prepare('DELETE FROM collections WHERE id=?').run('col1');
    const c = db.prepare('SELECT collection_id FROM courses WHERE id=?').get('c1') as any;
    expect(c.collection_id).toBeNull();
    db.close();
  });

  it('aplica FK on e WAL', () => {
    const db = openDb(':memory:');
    expect(pragma(db, 'foreign_keys')).toBe(1);
    db.close();
  });

  it('v1 → v2 preserva dados e marca cursos como local', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_V1);
    pragma(db, 'user_version = 1');
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO courses (id, title, root_path, structure, archived, created_at, updated_at) VALUES ('c1','X','/x','flat',0,?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, missing) VALUES ('l1','c1','a.mp4','A',0,0,1,1,'mp4',1,0)",
    ).run();
    migrate(db, 2);
    expect(pragma(db, 'user_version')).toBe(2);
    const c = db.prepare('SELECT source, drive_folder_id FROM courses WHERE id=?').get('c1') as any;
    expect(c.source).toBe('local');
    expect(c.drive_folder_id).toBeNull();
    const l = db.prepare('SELECT remote_id FROM lessons WHERE id=?').get('l1') as any;
    expect(l.remote_id).toBeNull();
    db.close();
  });

  it('migrate é idempotente na última versão', () => {
    const db = openDb(':memory:');
    expect(() => migrate(db)).not.toThrow();
    expect(pragma(db, 'user_version')).toBe(6);
    db.close();
  });

  // O CHECK de courses.source não se altera no SQLite: a v3 reconstrói a tabela.
  // Reconstruir é onde dado se perde de verdade — biblioteca, capa, aulas e
  // progresso (que pendem de courses por FK) precisam sobreviver intactos.
  it('v2 → v3 reconstrói courses sem perder nada e passa a aceitar telegram', () => {
    const db = new DatabaseSync(':memory:');
    pragma(db, 'foreign_keys = ON');
    migrate(db, 2);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO collections (id, name, created_at) VALUES (?,?,?)').run('col1', 'Inglês', now);
    db.prepare(
      `INSERT INTO courses (id, title, root_path, structure, archived, sort_index, poster_lesson_id, cover_path, collection_id, created_at, updated_at, last_scanned_at, source, drive_folder_id, drive_resource_key)
       VALUES ('c1','Curso','link','flat',1,7,'l1','/capa.jpg','col1',?,?,?,'drive','pasta','rk')`,
    ).run(now, now, now);
    db.prepare(
      "INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, missing, remote_id) VALUES ('l1','c1','a.mp4','A',0,0,1,1,'mp4',1,0,'r1')",
    ).run();
    db.prepare("INSERT INTO progress (lesson_id, position_sec, furthest_sec, updated_at) VALUES ('l1', 42, 50, ?)").run(now);
    const antes = db.prepare('SELECT * FROM courses').get();

    migrate(db, 3);

    expect(pragma(db, 'user_version')).toBe(3);
    const depois = db.prepare('SELECT * FROM courses').get() as Record<string, unknown>;
    expect({ ...depois, telegram_peer: undefined }).toEqual({ ...(antes as object), telegram_peer: undefined });
    expect(depois.telegram_peer).toBeNull();
    expect((db.prepare('SELECT position_sec FROM progress').get() as any).position_sec).toBe(42);
    expect(pragma(db, 'foreign_keys')).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    db.prepare(
      "INSERT INTO courses (id, title, root_path, structure, created_at, updated_at, source, telegram_peer) VALUES ('c2','T','t.me/x','flat',?,?,'telegram','{}')",
    ).run(now, now);
    expect(() =>
      db.prepare("INSERT INTO courses (id, title, root_path, structure, created_at, updated_at, source) VALUES ('c3','T','x','flat',?,?,'outro')").run(now, now),
    ).toThrow();

    // O cascade continua de pé depois da troca de tabela.
    db.prepare('DELETE FROM courses WHERE id=?').run('c1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM progress').get()).toEqual({ n: 0 });
    db.close();
  });

  // Card de aula apagada fica no curso; curso apagado leva os cards (no Anki eles ficam).
  it('v4 cria flashcards com aula SET NULL e curso CASCADE', () => {
    const db = openDb(':memory:');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO courses (id, title, root_path, structure, created_at, updated_at) VALUES ('c1','X','/x','flat',?,?)").run(now, now);
    db.prepare(
      "INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, missing) VALUES ('l1','c1','a.mp4','A',0,0,1,1,'mp4',1,0)",
    ).run();
    const card = db.prepare(
      'INSERT INTO flashcards (id, course_id, lesson_id, frente, verso, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)',
    );
    card.run('f1', 'c1', 'l1', 'F', 'V', now, now);
    card.run('f2', null, null, 'Geral', 'V', now, now);
    db.prepare("DELETE FROM lessons WHERE id='l1'").run();
    expect(db.prepare("SELECT course_id, lesson_id FROM flashcards WHERE id='f1'").get()).toEqual({ course_id: 'c1', lesson_id: null });
    db.prepare("DELETE FROM courses WHERE id='c1'").run();
    expect(db.prepare('SELECT id FROM flashcards').all()).toEqual([{ id: 'f2' }]);
    db.close();
  });
});
