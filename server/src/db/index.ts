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
const ULTIMA_VERSAO = 6;

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
  if (version < 4 && ate >= 4) {
    // Flashcards (anki/). Curso e aula nulos = card geral; aula nula com curso =
    // card do curso todo. Apagar a aula (re-scan) não pode levar o card que a
    // pessoa escreveu: ele fica no curso. Apagar o curso leva os cards daqui,
    // e no Anki eles continuam. `pendente` é o que ainda falta mandar ao Anki.
    transaction(db, () => {
      db.exec(`
        CREATE TABLE flashcards (
          id TEXT PRIMARY KEY,
          course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
          lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
          minuto_sec REAL,
          frente TEXT NOT NULL,
          verso TEXT NOT NULL,
          anki_note_id INTEGER,
          pendente TEXT CHECK (pendente IN ('criar','editar','apagar')),
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL
        );
        CREATE INDEX idx_flashcards_course ON flashcards(course_id);
        CREATE INDEX idx_flashcards_lesson ON flashcards(lesson_id);
      `);
      pragma(db, 'user_version = 4');
    });
  }
  if (version < 5 && ate >= 5) {
    // Conta e nuvem (nuvem/). Gatilhos anotam em nuvem_fila o que mudou nas tabelas
    // que sobem; o enviador lê a fila e manda ao Supabase. Assim nenhuma rota
    // precisou saber da nuvem. Uma linha por (tabela, chave): mudar a mesma aula
    // dez vezes é um envio só. Reanotar dá um seq novo, e o enviador só apaga os
    // seqs que leu: uma mudança que chega durante o envio não se perde.
    // Quando quem escreve é a própria sincronização (descida), nuvem_estado tem
    // 'aplicando' e os gatilhos não disparam: senão tudo que desce subiria de volta.
    // Só as colunas que vão para a nuvem disparam: o re-scan regrava mtime e capa
    // de toda aula, e isso não é mudança da conta.
    const CHAVE_AULA = "json_object('curso', X.course_id, 'rel', X.rel_path)";
    const quieto = "NOT EXISTS (SELECT 1 FROM nuvem_estado WHERE chave = 'aplicando')";
    const gatilhos: Array<[string, string, string, string]> = [
      // [tabela, colunas do UPDATE, nome na fila, chave]
      ['collections', 'name, sort_index', 'colecao', 'X.id'],
      [
        'courses',
        'title, root_path, structure, archived, sort_index, collection_id, poster_lesson_id, drive_folder_id, drive_resource_key, telegram_peer',
        'curso',
        'X.id',
      ],
      ['lessons', 'title, module, order_index, module_order, duration_sec, remote_id, rel_path', 'aula', CHAVE_AULA],
      ['progress', 'position_sec, furthest_sec, duration_sec, completed, completed_at, auto_completed', 'progresso', 'X.lesson_id'],
      ['flashcards', 'frente, verso, lesson_id, course_id, minuto_sec, anki_note_id, pendente', 'flashcard', 'X.id'],
    ];
    const sql = [
      `CREATE TABLE nuvem_fila (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         tabela TEXT NOT NULL,
         chave TEXT NOT NULL,
         UNIQUE (tabela, chave)
       );`,
      `CREATE TABLE nuvem_estado (chave TEXT PRIMARY KEY, valor TEXT);`,
    ];
    for (const [t, cols, nome, chave] of gatilhos) {
      // DELETE + INSERT e não OR REPLACE: dentro de um gatilho disparado por ação de
      // chave estrangeira (curso apagado → SET NULL), o OR REPLACE do gatilho não vale
      // e o UNIQUE derrubava a operação de quem só queria apagar uma biblioteca.
      const ins = (X: string) => {
        const k = chave.replaceAll('X.', X + '.');
        return `DELETE FROM nuvem_fila WHERE tabela = '${nome}' AND chave = ${k}; INSERT INTO nuvem_fila (tabela, chave) VALUES ('${nome}', ${k});`;
      };
      sql.push(
        `CREATE TRIGGER nuvem_${t}_ins AFTER INSERT ON ${t} WHEN ${quieto} BEGIN ${ins('NEW')} END;`,
        `CREATE TRIGGER nuvem_${t}_upd AFTER UPDATE OF ${cols} ON ${t} WHEN ${quieto} BEGIN ${ins('NEW')} ${ins('OLD')} END;`,
        `CREATE TRIGGER nuvem_${t}_del AFTER DELETE ON ${t} WHEN ${quieto} BEGIN ${ins('OLD')} END;`,
      );
    }
    transaction(db, () => {
      db.exec(sql.join('\n'));
      pragma(db, 'user_version = 5');
    });
  }
  if (version < 6 && ate >= 6) {
    // PDFs (livros, questões, apostilas): routes/documentos.ts. Um arquivo do disco
    // por linha, nunca copiado nem alterado. A categoria é texto livre: as que
    // existem são as que algum PDF usa, sem tabela à parte para ficar órfã.
    // `leitura_em` é quando a pessoa mexeu na leitura (página ou lido): decide
    // quem vence entre duas máquinas, como o alterado_em do progresso.
    transaction(db, () => {
      db.exec(`
        CREATE TABLE documentos (
          id TEXT PRIMARY KEY,
          titulo TEXT NOT NULL,
          categoria TEXT,
          caminho TEXT NOT NULL,
          tamanho INTEGER NOT NULL DEFAULT 0,
          paginas INTEGER,
          pagina INTEGER NOT NULL DEFAULT 1,
          lido INTEGER NOT NULL DEFAULT 0,
          lido_em TEXT,
          leitura_em TEXT,
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL
        );
        CREATE INDEX idx_documentos_caminho ON documentos(caminho);
        CREATE TRIGGER nuvem_documentos_ins AFTER INSERT ON documentos
          WHEN NOT EXISTS (SELECT 1 FROM nuvem_estado WHERE chave = 'aplicando')
          BEGIN DELETE FROM nuvem_fila WHERE tabela = 'documento' AND chave = NEW.id;
                INSERT INTO nuvem_fila (tabela, chave) VALUES ('documento', NEW.id); END;
        CREATE TRIGGER nuvem_documentos_upd AFTER UPDATE OF titulo, categoria, caminho, paginas, pagina, lido ON documentos
          WHEN NOT EXISTS (SELECT 1 FROM nuvem_estado WHERE chave = 'aplicando')
          BEGIN DELETE FROM nuvem_fila WHERE tabela = 'documento' AND chave = NEW.id;
                INSERT INTO nuvem_fila (tabela, chave) VALUES ('documento', NEW.id); END;
        CREATE TRIGGER nuvem_documentos_del AFTER DELETE ON documentos
          WHEN NOT EXISTS (SELECT 1 FROM nuvem_estado WHERE chave = 'aplicando')
          BEGIN DELETE FROM nuvem_fila WHERE tabela = 'documento' AND chave = OLD.id;
                INSERT INTO nuvem_fila (tabela, chave) VALUES ('documento', OLD.id); END;
      `);
      pragma(db, 'user_version = 6');
    });
  }
}

export function openDb(dbPath: string): Db {
  const db = new DatabaseSync(dbPath);
  pragma(db, 'journal_mode = WAL');
  pragma(db, 'foreign_keys = ON');
  migrate(db);
  return db;
}
