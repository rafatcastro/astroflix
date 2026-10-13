import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { ServicosAnki } from '../anki/servicos';

// Flashcards: o espelho local (tabela flashcards) e a ida/volta com o Anki (anki/).
// Toda rota responde com a cópia local mesmo com o Anki fechado: o card criado
// fica pendente e vai quando o Anki voltar, e `anki` diz à interface em que pé está.

const MAX_TEXTO = 10_000;

interface Linha {
  id: string;
  course_id: string | null;
  lesson_id: string | null;
  minuto_sec: number | null;
  frente: string;
  verso: string;
  anki_note_id: number | null;
  pendente: string | null;
  criado_em: string;
  course_title: string | null;
  lesson_title: string | null;
}

const SELECT = `SELECT f.*, c.title AS course_title, l.title AS lesson_title
  FROM flashcards f LEFT JOIN courses c ON c.id = f.course_id LEFT JOIN lessons l ON l.id = f.lesson_id`;

const dto = (r: Linha) => ({
  id: r.id,
  courseId: r.course_id,
  courseTitle: r.course_title,
  lessonId: r.lesson_id,
  lessonTitle: r.lesson_title,
  minutoSec: r.minuto_sec,
  frente: r.frente,
  verso: r.verso,
  // Já está no Anki e sem nada pendente.
  noAnki: r.anki_note_id != null && r.pendente == null,
  criadoEm: r.criado_em,
});

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\r\n/g, '\n').trim();
  return t && t.length <= MAX_TEXTO ? t : null;
};

export async function flashcardsRoutes(app: FastifyInstance, opts: { db: Db; anki: ServicosAnki }): Promise<void> {
  const { db, anki } = opts;
  const umCard = (id: string) => db.prepare(`${SELECT} WHERE f.id=?`).get(id) as Linha | undefined;

  app.get('/api/flashcards', async (req) => {
    const q = req.query as { lessonId?: string; courseId?: string; geral?: string };
    let where = "f.pendente IS NOT 'apagar'";
    const args: string[] = [];
    if (q.lessonId) {
      where += ' AND f.lesson_id=?';
      args.push(q.lessonId);
    } else if (q.courseId) {
      where += ' AND f.course_id=?';
      args.push(q.courseId);
    } else if (q.geral === '1') {
      where += ' AND f.course_id IS NULL';
    }
    const consulta = db.prepare(`${SELECT} WHERE ${where} ORDER BY f.lesson_id IS NOT NULL, l.order_index, f.minuto_sec, f.criado_em`);
    // Primeiro manda o que estava pendente, depois relê no Anki o que vai aparecer.
    let estado = await anki.enviarPendentes();
    if (estado !== 'fechado') {
      const ids = (consulta.all(...args) as unknown as Linha[]).map((r) => r.id);
      const lido = await anki.atualizarDoAnki(ids);
      if (lido !== 'conectado') estado = lido;
    }
    const cards = (consulta.all(...args) as unknown as Linha[]).map(dto);
    return { cards, anki: estado, pendentes: anki.pendentes() };
  });

  app.post('/api/flashcards', async (req, reply) => {
    const b = (req.body ?? {}) as { frente?: unknown; verso?: unknown; courseId?: unknown; lessonId?: unknown; minutoSec?: unknown };
    const frente = texto(b.frente);
    const verso = texto(b.verso);
    if (!frente || !verso) return reply.code(400).send({ error: 'frente-e-verso' });

    let courseId: string | null = null;
    let lessonId: string | null = null;
    let minuto: number | null = null;
    if (typeof b.lessonId === 'string') {
      const aula = db.prepare('SELECT course_id FROM lessons WHERE id=?').get(b.lessonId) as { course_id: string } | undefined;
      if (!aula) return reply.code(404).send({ error: 'aula' });
      lessonId = b.lessonId;
      courseId = aula.course_id;
      if (typeof b.minutoSec === 'number' && Number.isFinite(b.minutoSec) && b.minutoSec >= 0) minuto = b.minutoSec;
    } else if (typeof b.courseId === 'string') {
      if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(b.courseId)) return reply.code(404).send({ error: 'curso' });
      courseId = b.courseId;
    }

    const id = randomUUID();
    const agora = new Date().toISOString();
    db.prepare(
      `INSERT INTO flashcards (id, course_id, lesson_id, minuto_sec, frente, verso, pendente, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, 'criar', ?, ?)`,
    ).run(id, courseId, lessonId, minuto, frente, verso, agora, agora);
    const estado = await anki.enviarPendentes();
    return reply.code(201).send({ card: dto(umCard(id)!), anki: estado });
  });

  app.patch('/api/flashcards/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const atual = umCard(id);
    if (!atual || atual.pendente === 'apagar') return reply.code(404).send({ error: 'not_found' });
    const b = (req.body ?? {}) as { frente?: unknown; verso?: unknown };
    const frente = b.frente === undefined ? atual.frente : texto(b.frente);
    const verso = b.verso === undefined ? atual.verso : texto(b.verso);
    if (!frente || !verso) return reply.code(400).send({ error: 'frente-e-verso' });
    // Card que nem chegou ao Anki continua 'criar' (vai já com o texto novo).
    db.prepare(
      `UPDATE flashcards SET frente=?, verso=?, atualizado_em=?,
         pendente=CASE WHEN pendente='criar' THEN 'criar' ELSE 'editar' END WHERE id=?`,
    ).run(frente, verso, new Date().toISOString(), id);
    const estado = await anki.enviarPendentes();
    return { card: dto(umCard(id)!), anki: estado };
  });

  app.delete('/api/flashcards/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const atual = umCard(id);
    if (!atual) return reply.code(404).send({ error: 'not_found' });
    // Nunca chegou ao Anki: some na hora. Já está lá: só sai daqui quando o Anki apagar.
    if (atual.anki_note_id == null) db.prepare('DELETE FROM flashcards WHERE id=?').run(id);
    else db.prepare("UPDATE flashcards SET pendente='apagar', atualizado_em=? WHERE id=?").run(new Date().toISOString(), id);
    const estado = await anki.enviarPendentes();
    return { anki: estado };
  });

  app.get('/api/anki/status', async () => ({ estado: await anki.verificar(), pendentes: anki.pendentes() }));
}
