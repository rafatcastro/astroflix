import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import { SELECT_CARDS, baralhoDoCard, type ServicosAnki } from '../anki/servicos';
import { baralhoDe } from '../anki/texto';

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
  documento_id: string | null;
  pagina: number | null;
  collection_id: string | null;
  course_title: string | null;
  lesson_title: string | null;
  documento_titulo: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
}

const SELECT = SELECT_CARDS;

const dto = (r: Linha) => ({
  id: r.id,
  courseId: r.course_id,
  courseTitle: r.course_title,
  lessonId: r.lesson_id,
  lessonTitle: r.lesson_title,
  minutoSec: r.minuto_sec,
  documentoId: r.documento_id,
  documentoTitulo: r.documento_titulo,
  pagina: r.pagina,
  categoriaId: r.categoria_id,
  baralho: baralhoDoCard(r),
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
    const q = req.query as { lessonId?: string; courseId?: string; documentoId?: string; categoria?: string; geral?: string };
    let where = "f.pendente IS NOT 'apagar'";
    const args: string[] = [];
    if (q.lessonId) {
      where += ' AND f.lesson_id=?';
      args.push(q.lessonId);
    } else if (q.courseId) {
      where += ' AND f.course_id=?';
      args.push(q.courseId);
    } else if (q.documentoId) {
      where += ' AND f.documento_id=?';
      args.push(q.documentoId);
    } else if (q.categoria) {
      // Tudo da categoria: as gerais dela e as dos cursos e PDFs que estão nela.
      if (q.categoria === 'sem') where += ' AND cat.id IS NULL';
      else {
        where += ' AND cat.id=?';
        args.push(q.categoria);
      }
      if (q.geral === '1') where += ' AND f.course_id IS NULL AND f.documento_id IS NULL';
    } else if (q.geral === '1') {
      where += ' AND f.course_id IS NULL AND f.documento_id IS NULL';
    }
    const consulta = db.prepare(
      `${SELECT} WHERE ${where} ORDER BY f.course_id IS NOT NULL, f.documento_id IS NOT NULL, c.title, d.titulo, f.lesson_id IS NOT NULL, l.order_index, f.minuto_sec, f.pagina, f.criado_em`,
    );
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
    const b = (req.body ?? {}) as {
      frente?: unknown;
      verso?: unknown;
      courseId?: unknown;
      lessonId?: unknown;
      minutoSec?: unknown;
      documentoId?: unknown;
      pagina?: unknown;
      categoriaId?: unknown;
    };
    const frente = texto(b.frente);
    const verso = texto(b.verso);
    if (!frente || !verso) return reply.code(400).send({ error: 'frente-e-verso' });

    let courseId: string | null = null;
    let lessonId: string | null = null;
    let minuto: number | null = null;
    let documentoId: string | null = null;
    let pagina: number | null = null;
    let categoriaId: string | null = null;
    if (typeof b.documentoId === 'string') {
      if (!db.prepare('SELECT 1 FROM documentos WHERE id=?').get(b.documentoId)) return reply.code(404).send({ error: 'documento' });
      documentoId = b.documentoId;
      if (typeof b.pagina === 'number' && Number.isInteger(b.pagina) && b.pagina >= 1) pagina = b.pagina;
    } else if (typeof b.lessonId === 'string') {
      const aula = db.prepare('SELECT course_id FROM lessons WHERE id=?').get(b.lessonId) as { course_id: string } | undefined;
      if (!aula) return reply.code(404).send({ error: 'aula' });
      lessonId = b.lessonId;
      courseId = aula.course_id;
      if (typeof b.minutoSec === 'number' && Number.isFinite(b.minutoSec) && b.minutoSec >= 0) minuto = b.minutoSec;
    } else if (typeof b.courseId === 'string') {
      if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(b.courseId)) return reply.code(404).send({ error: 'curso' });
      courseId = b.courseId;
    } else if (typeof b.categoriaId === 'string') {
      // Questão geral da categoria: vai para Astroflix::<categoria>.
      if (!db.prepare('SELECT 1 FROM collections WHERE id=?').get(b.categoriaId)) return reply.code(404).send({ error: 'categoria' });
      categoriaId = b.categoriaId;
    }

    const id = randomUUID();
    const agora = new Date().toISOString();
    db.prepare(
      `INSERT INTO flashcards (id, course_id, lesson_id, minuto_sec, documento_id, pagina, collection_id, frente, verso, pendente, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'criar', ?, ?)`,
    ).run(id, courseId, lessonId, minuto, documentoId, pagina, categoriaId, frente, verso, agora, agora);
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

  // O baralho de um lugar, para a interface mostrar onde o card vai parar antes de criar.
  app.get('/api/anki/baralho', async (req) => {
    const q = req.query as { categoria?: string; courseId?: string; documentoId?: string };
    const categoria = (id: string | null | undefined) =>
      id ? ((db.prepare('SELECT name FROM collections WHERE id=?').get(id) as { name: string } | undefined)?.name ?? null) : null;
    if (q.courseId) {
      const c = db.prepare('SELECT title, collection_id FROM courses WHERE id=?').get(q.courseId) as { title: string; collection_id: string | null } | undefined;
      return { baralho: baralhoDe({ categoria: categoria(c?.collection_id), curso: c?.title ?? '' }) };
    }
    if (q.documentoId) {
      const d = db.prepare('SELECT titulo, collection_id FROM documentos WHERE id=?').get(q.documentoId) as { titulo: string; collection_id: string | null } | undefined;
      return { baralho: baralhoDe({ categoria: categoria(d?.collection_id), pdf: d?.titulo ?? '' }) };
    }
    if (q.categoria && q.categoria !== 'sem') return { baralho: baralhoDe({ categoria: categoria(q.categoria) }) };
    return { baralho: baralhoDe({ categoria: null, geral: true }) };
  });

  app.get('/api/anki/status', async () => ({ estado: await anki.verificar(), pendentes: anki.pendentes() }));
}
