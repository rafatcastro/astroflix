import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';

// Categorias (a tabela ainda se chama collections: eram as "bibliotecas" de cursos).
// Cada uma junta cursos, PDFs e questões, e o menu principal as lista pela última
// aberta. Excluir uma categoria nunca toca no que está dentro (ON DELETE SET NULL).
export async function collectionsRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/api/collections', async () => {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.acessado_em,
           (SELECT COUNT(*) FROM courses co WHERE co.collection_id = c.id AND co.archived = 0) AS n,
           (SELECT COUNT(*) FROM documentos d WHERE d.collection_id = c.id) AS pdfs
         FROM collections c
         ORDER BY c.acessado_em IS NULL, c.acessado_em DESC, c.name COLLATE NOCASE`,
      )
      .all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, courseCount: r.n, pdfCount: r.pdfs, acessadoEm: r.acessado_em ?? null }));
  });

  app.post('/api/collections', async (req, reply) => {
    const b = req.body as { name?: unknown };
    if (typeof b?.name !== 'string' || b.name.trim() === '') {
      return reply.code(400).send({ error: 'invalid_name' });
    }
    const id = randomUUID();
    db.prepare('INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)').run(
      id,
      b.name.trim(),
      new Date().toISOString(),
    );
    return reply.code(201).send({ id, name: b.name.trim() });
  });

  app.patch('/api/collections/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!db.prepare('SELECT 1 FROM collections WHERE id=?').get(id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const b = req.body as { name?: unknown };
    if (typeof b?.name !== 'string' || b.name.trim() === '') {
      return reply.code(400).send({ error: 'invalid_name' });
    }
    db.prepare('UPDATE collections SET name=? WHERE id=?').run(b.name.trim(), id);
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
