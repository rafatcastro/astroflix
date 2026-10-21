import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { ServicosDrive } from '../drive/servicos';
import type { AppConfig } from '../config';
import { apagarBaixado } from '../armazenamento';

export async function lessonsRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig; drive?: ServicosDrive }): Promise<void> {
  const { db, config, drive } = opts;

  app.get('/api/lessons/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = db.prepare(`
      SELECT l.*, c.title AS course_title, c.source AS course_source,
        p.position_sec, p.furthest_sec, p.completed, p.duration_sec AS p_dur
      FROM lessons l JOIN courses c ON c.id = l.course_id
      LEFT JOIN progress p ON p.lesson_id = l.id
      WHERE l.id = ?
    `).get(id) as any;
    if (!r) { reply.code(404); return { error: 'not_found' }; }
    // Abrir a aula baixa ela e as próximas, antes de qualquer outro download (ver baixar.ts).
    if (r.course_source === 'drive' || r.course_source === 'telegram') drive?.baixador.pedirAula(id);

    const prev = db.prepare('SELECT id FROM lessons WHERE course_id=? AND order_index<? ORDER BY order_index DESC LIMIT 1').get(r.course_id, r.order_index) as any;
    const next = db.prepare('SELECT id FROM lessons WHERE course_id=? AND order_index>? ORDER BY order_index ASC LIMIT 1').get(r.course_id, r.order_index) as any;

    return {
      id: r.id, title: r.title, module: r.module, relPath: r.rel_path,
      orderIndex: r.order_index, durationSec: r.duration_sec ?? r.p_dur ?? null,
      container: r.container, playable: !!r.playable, missing: !!r.missing,
      position: r.position_sec ?? 0, furthest: r.furthest_sec ?? 0, completed: !!r.completed,
      courseId: r.course_id, courseTitle: r.course_title,
      // O player precisa saber a origem: erro de vídeo do Drive/Telegram se explica por autorização/cota, não por formato.
      courseSource: r.course_source === 'drive' || r.course_source === 'telegram' ? r.course_source : 'local',
      prevLessonId: prev?.id ?? null, nextLessonId: next?.id ?? null,
    };
  });

  // O botão direito da aula na página do curso (Drive e Telegram).
  const aulaRemota = (id: string) =>
    db
      .prepare("SELECT l.id, l.course_id, l.rel_path FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id=? AND c.source IN ('drive','telegram')")
      .get(id) as { id: string; course_id: string; rel_path: string } | undefined;

  app.post('/api/lessons/:id/baixar', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!aulaRemota(id)) return reply.code(404).send({ error: 'not_found' });
    if (!drive) return reply.code(503).send({ error: 'sem-conexao' });
    drive.baixador.baixarAula(id);
    return reply.code(202).send();
  });

  app.delete('/api/lessons/:id/baixado', async (req, reply) => {
    const a = aulaRemota((req.params as { id: string }).id);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    await drive?.baixador.esquecerAula(a.id);
    apagarBaixado(db, config, { tipo: 'aula', id: a.id, courseId: a.course_id, relPath: a.rel_path });
    return reply.code(204).send();
  });

  app.patch('/api/lessons/:id/progress', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = req.body as { position_sec: number; furthest_sec: number; duration_sec: number | null };
    if (!db.prepare('SELECT 1 FROM lessons WHERE id=?').get(id)) { reply.code(404); return { error: 'not_found' }; }
    db.prepare(`
      INSERT INTO progress (lesson_id, position_sec, furthest_sec, duration_sec, updated_at)
      VALUES (@id, @pos, @furthest, @dur, @now)
      ON CONFLICT(lesson_id) DO UPDATE SET
        position_sec = excluded.position_sec,
        furthest_sec = MAX(furthest_sec, excluded.furthest_sec),
        duration_sec = COALESCE(excluded.duration_sec, duration_sec),
        updated_at   = excluded.updated_at
    `).run({ id, pos: b.position_sec, furthest: b.furthest_sec, dur: b.duration_sec ?? null, now: new Date().toISOString() });
    reply.code(204);
  });

  app.post('/api/lessons/:id/complete', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = req.body as { completed: boolean };
    const aula = db
      .prepare('SELECT l.course_id, c.source FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id=?')
      .get(id) as { course_id: string; source: string } | undefined;
    if (!aula) { reply.code(404); return { error: 'not_found' }; }
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO progress (lesson_id, position_sec, furthest_sec, completed, completed_at, auto_completed, updated_at)
      VALUES (@id, 0, 0, @completed, @completedAt, 0, @now)
      ON CONFLICT(lesson_id) DO UPDATE SET
        completed = excluded.completed,
        completed_at = excluded.completed_at,
        auto_completed = 0,
        updated_at = excluded.updated_at
    `).run({ id, completed: b.completed ? 1 : 0, completedAt: b.completed ? now : null, now });
    reply.code(204);
  });
}
