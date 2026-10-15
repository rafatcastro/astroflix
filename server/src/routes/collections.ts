import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { transaction, type Db } from '../db';

// Categorias (a tabela ainda se chama collections: eram as "bibliotecas" de cursos).
// Cada uma junta cursos, PDFs e questões, e o menu principal as lista pela última
// aberta. Excluir uma categoria nunca toca no que está dentro (ON DELETE SET NULL).
// Um emoji só (que pode ser vários code points: 👩🏽‍💻), ou nada. O teto barra texto
// colado por engano sem precisar de uma tabela de emojis no servidor.
function emojiDe(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return null;
  return [...t].length <= 10 && !/[\p{L}\p{N}]/u.test(t) ? t : undefined;
}

export async function collectionsRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/api/collections', async () => {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.emoji, c.acessado_em,
           (SELECT COUNT(*) FROM courses co WHERE co.collection_id = c.id AND co.archived = 0) AS n,
           (SELECT COUNT(*) FROM documentos d WHERE d.collection_id = c.id) AS pdfs
         FROM collections c
         ORDER BY c.acessado_em IS NULL, c.acessado_em DESC, c.name COLLATE NOCASE`,
      )
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji ?? null,
      courseCount: r.n,
      pdfCount: r.pdfs,
      acessadoEm: r.acessado_em ?? null,
    }));
  });

  app.post('/api/collections', async (req, reply) => {
    const b = req.body as { name?: unknown; emoji?: unknown; adotarSemCategoria?: unknown };
    if (typeof b?.name !== 'string' || b.name.trim() === '') {
      return reply.code(400).send({ error: 'invalid_name' });
    }
    const emoji = emojiDe(b.emoji);
    if (b.emoji !== undefined && emoji === undefined) return reply.code(400).send({ error: 'invalid_emoji' });
    const id = randomUUID();
    db.prepare('INSERT INTO collections (id, name, created_at, emoji) VALUES (?, ?, ?, ?)').run(
      id,
      b.name.trim(),
      new Date().toISOString(),
      emoji ?? null,
    );
    // "Sem categoria" ganhou nome: tudo o que estava sem vai para ela. As questões
    // gerais sem categoria também (os cards de curso e PDF seguem o curso e o PDF).
    if (b.adotarSemCategoria === true) {
      transaction(db, () => {
        db.prepare('UPDATE courses SET collection_id=? WHERE collection_id IS NULL').run(id);
        db.prepare('UPDATE documentos SET collection_id=? WHERE collection_id IS NULL').run(id);
        db.prepare('UPDATE flashcards SET collection_id=? WHERE collection_id IS NULL AND course_id IS NULL AND documento_id IS NULL').run(id);
      });
    }
    return reply.code(201).send({ id, name: b.name.trim(), emoji: emoji ?? null });
  });

  app.patch('/api/collections/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!db.prepare('SELECT 1 FROM collections WHERE id=?').get(id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const b = (req.body ?? {}) as { name?: unknown; emoji?: unknown };
    if (b.name !== undefined && (typeof b.name !== 'string' || b.name.trim() === '')) {
      return reply.code(400).send({ error: 'invalid_name' });
    }
    const emoji = emojiDe(b.emoji);
    if (b.emoji !== undefined && emoji === undefined) return reply.code(400).send({ error: 'invalid_emoji' });
    if (typeof b.name === 'string') db.prepare('UPDATE collections SET name=? WHERE id=?').run(b.name.trim(), id);
    if (b.emoji !== undefined) db.prepare('UPDATE collections SET emoji=? WHERE id=?').run(emoji ?? null, id);
    return { ok: true };
  });

  // Entrou na categoria: ela sobe para o começo do menu principal.
  app.post('/api/collections/:id/acesso', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = db.prepare('UPDATE collections SET acessado_em=? WHERE id=?').run(new Date().toISOString(), id);
    if (!r.changes) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.delete('/api/collections/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!db.prepare('SELECT 1 FROM collections WHERE id=?').get(id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    db.prepare('DELETE FROM collections WHERE id=?').run(id); // cursos ficam (SET NULL)
    return reply.code(204).send();
  });
}
