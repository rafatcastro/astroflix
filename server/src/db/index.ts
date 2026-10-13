import { createRequire } from 'node:module';
import type { DatabaseSync as TipoDoBanco } from 'node:sqlite';
import { SCHEMA_V1 } from './schema';

// node:sqlite entra por require(), e não por import estático, para o aviso de
// "feature experimental" poder ser silenciado (ver quiet.ts).
//
// O motivo é sutil: em ESM, os módulos embutidos são instanciados na fase de
// LIGAÇÃO, antes de qualquer corpo de módulo rodar — inclusive o do quiet.ts.
// Um require() é chamada de execução, então acontece depois do filtro estar de
// pé. O `import type` acima não conta: tipos somem na compilação e não criam
// dependência nenhuma em tempo de execução.
//
// O ternário cobre os dois formatos em que este código roda: empacotado em
// CommonJS (onde require é nativo) e direto do fonte em ESM pelo tsx (onde não
// é, e o createRequire resolve).
declare const require: NodeJS.Require | undefined;
const requerer: NodeJS.Require = typeof require === 'function' ? require : createRequire(import.meta.url);

const { DatabaseSync } = requerer('node:sqlite') as {
  DatabaseSync: new (caminho: string) => TipoDoBanco;
};

/**
 * O banco do Learnflix usa o SQLite que já vem dentro do Node (`node:sqlite`),
 * e não um módulo nativo.
 *
 * O motivo é a embalagem: um `.node` compilado não entra num executável único,
 * então enquanto o SQLite fosse um módulo nativo o app jamais viraria "baixe um
 * arquivo e rode". Sem ele, o servidor inteiro é JavaScript puro.
 *
 * Em troca, faltam dois açúcares que o better-sqlite3 dava de graça — `pragma()`
 * e `transaction()`. Estão aqui embaixo, e são a única coisa que o resto do
 * código precisa saber sobre a diferença.
 */
export type Db = TipoDoBanco;

/**
 * Lê ou escreve um PRAGMA.
 *
 * `pragma(db, 'user_version')` lê; `pragma(db, 'user_version = 2')` escreve.
 * Leitura devolve o primeiro (e único) valor da linha, como o better-sqlite3
 * fazia com `{ simple: true }`.
 */
export function pragma(db: Db, expr: string): unknown {
  if (expr.includes('=')) {
    db.exec(`PRAGMA ${expr}`);
    return undefined;
  }
  const row = db.prepare(`PRAGMA ${expr}`).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

// Profundidade POR BANCO, não global: a suíte de testes mantém vários bancos
// abertos ao mesmo tempo, e um contador único faria um confundir o estado do
// outro. WeakMap para o banco poder ser coletado normalmente.
const profundidade = new WeakMap<Db, number>();

/**
 * Roda `fn` dentro de uma transação, desfazendo tudo se algo falhar.
 *
 * Aninhamento usa SAVEPOINT porque o SQLite recusa BEGIN dentro de BEGIN — e
 * aninhar acontece de verdade: o import chama createCourseFromPath, que já abre
 * a própria transação.
 */
export function transaction(db: Db, fn: () => void): void {
  const nivel = profundidade.get(db) ?? 0;
  const ponto = `learnflix_sp_${nivel}`;

  db.exec(nivel === 0 ? 'BEGIN' : `SAVEPOINT ${ponto}`);
  profundidade.set(db, nivel + 1);

  try {
    fn();
    db.exec(nivel === 0 ? 'COMMIT' : `RELEASE ${ponto}`);
  } catch (err) {
    // ROLLBACK TO não encerra o savepoint — sem o RELEASE em seguida, ele
    // continuaria aberto e o próximo nível reusaria o mesmo nome.
    if (nivel === 0) db.exec('ROLLBACK');
    else {
      db.exec(`ROLLBACK TO ${ponto}`);
      db.exec(`RELEASE ${ponto}`);
    }
    throw err;
  } finally {
    profundidade.set(db, nivel);
  }
}

// Runner de migrações guardado por PRAGMA user_version. Para evoluir o schema,
// acrescente um bloco `if (version < N)` novo — nunca edite o SCHEMA_V1 no lugar,
// senão os bancos já existentes ficam para trás.
const ULTIMA_VERSAO = 3;

// `ate` existe para os testes montarem um banco parado numa versão antiga de
// verdade; o app sempre migra até a última.
export function migrate(db: Db, ate: number = ULTIMA_VERSAO): void {
  const version = pragma(db, 'user_version') as number;
  if (version < 1 && ate >= 1) {
    db.exec(SCHEMA_V1);
    pragma(db, 'user_version = 1');
  }
  if (version < 2 && ate >= 2) {
    // Cursos do Google Drive. `source` com DEFAULT 'local' deixa todo curso
    // existente como estava; o progresso segue preso ao rel_path, e o remote_id
    // é só o endereço da aula no Drive, nunca a identidade dela.
    transaction(db, () => {
      db.exec(`
        ALTER TABLE courses   ADD COLUMN source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','drive'));
        ALTER TABLE courses   ADD COLUMN drive_folder_id TEXT;
        ALTER TABLE courses   ADD COLUMN drive_resource_key TEXT;
        ALTER TABLE lessons   ADD COLUMN remote_id TEXT;
        ALTER TABLE materials ADD COLUMN remote_id TEXT;
      `);
      pragma(db, 'user_version = 2');
    });
  }
  if (version < 3 && ate >= 3) {
    // Cursos do Telegram. O CHECK de `source` não se altera no SQLite, então a
    // tabela é reconstruída pelo procedimento oficial (sqlite.org/lang_altertable):
    // FKs desligadas FORA da transação (dentro, o PRAGMA é ignorado), cópia,
    // troca de nome e foreign_key_check antes de confirmar. Sem desligar, o
    // DROP TABLE apagaria em cascata todas as aulas e todo o progresso.
    // telegram_peer guarda onde o grupo mora (ver PeerTelegram).
    const fkAntes = pragma(db, 'foreign_keys') as number;
    pragma(db, 'foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(`
          CREATE TABLE courses_v3 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            root_path TEXT NOT NULL,
            structure TEXT NOT NULL CHECK (structure IN ('modules','flat')),
            archived INTEGER NOT NULL DEFAULT 0,
            sort_index INTEGER,
            poster_lesson_id TEXT,
            cover_path TEXT,
            collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_scanned_at TEXT,
            source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','drive','telegram')),
            drive_folder_id TEXT,
            drive_resource_key TEXT,
            telegram_peer TEXT
          );
          INSERT INTO courses_v3 (id, title, root_path, structure, archived, sort_index, poster_lesson_id, cover_path,
                                  collection_id, created_at, updated_at, last_scanned_at, source, drive_folder_id, drive_resource_key)
            SELECT id, title, root_path, structure, archived, sort_index, poster_lesson_id, cover_path,
                   collection_id, created_at, updated_at, last_scanned_at, source, drive_folder_id, drive_resource_key
            FROM courses;
          DROP TABLE courses;
          ALTER TABLE courses_v3 RENAME TO courses;
        `);
        const quebradas = db.prepare('PRAGMA foreign_key_check').all();
        if (quebradas.length) throw new Error(`migração v3: ${quebradas.length} chaves estrangeiras quebradas`);
        pragma(db, 'user_version = 3');
      });
    } finally {
      if (fkAntes) pragma(db, 'foreign_keys = ON');
    }
  }
}

export function openDb(dbPath: string): Db {
  const db = new DatabaseSync(dbPath);
  pragma(db, 'journal_mode = WAL');
  pragma(db, 'foreign_keys = ON');
  migrate(db);
  return db;
}
