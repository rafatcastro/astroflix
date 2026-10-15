import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import { maquinaId } from '../nuvem/maquina';

// O painel de estudo da tela principal: pomodoros concluídos e tempo de aula.
// O timer roda na interface (é lá que estão o vídeo e o PDF); aqui só chega o
// resultado. Foco interrompido não é registrado.

/** A data local (YYYY-MM-DD): "hoje" é o dia do relógio da pessoa, não o do UTC. */
export function diaLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A semana começa na segunda.
function inicioDaSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

// A interface manda o tempo assistido a cada ~30 s; mais que isso num envio só é
// erro (ou relógio que pulou), e não pode inflar o painel.
const MAX_SEGUNDOS_POR_ENVIO = 120;
// Um foco tem de durar alguma coisa e caber num dia.
const MIN_MINUTOS = 1;
const MAX_MINUTOS = 240;

export async function estudoRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;
  const categoriaExiste = (id: unknown): string | null =>
    typeof id === 'string' && db.prepare('SELECT 1 FROM collections WHERE id=?').get(id) ? id : null;

  app.post('/api/estudo/pomodoros', async (req, reply) => {
    const b = (req.body ?? {}) as { categoriaId?: unknown; inicio?: unknown; fim?: unknown; minutos?: unknown };
    const minutos = Math.round(Number(b.minutos));
    const fim = typeof b.fim === 'string' ? new Date(b.fim) : new Date();
    const inicio = typeof b.inicio === 'string' ? new Date(b.inicio) : new Date(fim.getTime() - minutos * 60_000);
    if (!Number.isFinite(minutos) || minutos < MIN_MINUTOS || minutos > MAX_MINUTOS || isNaN(fim.getTime()) || isNaN(inicio.getTime())) {
      return reply.code(400).send({ error: 'pomodoro-invalido' });
    }
    const id = randomUUID();
    db.prepare('INSERT INTO pomodoros (id, collection_id, inicio, fim, minutos, dia) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      categoriaExiste(b.categoriaId),
      inicio.toISOString(),
      fim.toISOString(),
      minutos,
      diaLocal(fim),
    );
    return reply.code(201).send({ id });
  });

  app.post('/api/estudo/aula', async (req, reply) => {
    const b = (req.body ?? {}) as { lessonId?: unknown; segundos?: unknown };
    const segundos = Math.round(Number(b.segundos));
    if (typeof b.lessonId !== 'string' || !Number.isFinite(segundos) || segundos <= 0) return reply.code(400).send({ error: 'invalido' });
    const aula = db
      .prepare('SELECT c.id AS curso, c.collection_id AS categoria FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id=?')
      .get(b.lessonId) as { curso: string; categoria: string | null } | undefined;
    if (!aula) return reply.code(404).send({ error: 'aula-nao-encontrada' });
    const dia = diaLocal();
    // Uma linha por máquina, dia e curso: o mesmo id em toda subida, sem disputa entre máquinas.
    const id = createHash('sha256').update(`${maquinaId(db)}|${dia}|${aula.curso}`).digest('hex').slice(0, 32);
    db.prepare(
      `INSERT INTO tempo_aula (id, dia, course_id, collection_id, segundos) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET segundos = segundos + excluded.segundos, collection_id = excluded.collection_id`,
    ).run(id, dia, aula.curso, aula.categoria, Math.min(segundos, MAX_SEGUNDOS_POR_ENVIO));
    return reply.code(204).send();
  });

  app.get('/api/estudo/resumo', async () => {
    const agora = new Date();
    const desde = {
      hoje: diaLocal(agora),
      semana: diaLocal(inicioDaSemana(agora)),
      mes: diaLocal(new Date(agora.getFullYear(), agora.getMonth(), 1)),
      total: '',
    };
    const pom = db.prepare('SELECT COUNT(*) AS n FROM pomodoros WHERE dia >= ?');
    const aula = db.prepare('SELECT COALESCE(SUM(segundos), 0) AS s FROM tempo_aula WHERE dia >= ?');
    const periodo = (d: string) => ({
      pomodoros: (pom.get(d) as { n: number }).n,
      segundosAula: (aula.get(d) as { s: number }).s,
    });
    const porCategoria: Record<string, { pomodoros: number; segundosAula: number }> = {};
    const chave = (id: string | null) => id ?? 'sem';
    for (const r of db.prepare('SELECT collection_id AS c, COUNT(*) AS n FROM pomodoros WHERE dia = ? GROUP BY collection_id').all(desde.hoje) as any[]) {
      (porCategoria[chave(r.c)] ??= { pomodoros: 0, segundosAula: 0 }).pomodoros = r.n;
    }
    for (const r of db.prepare('SELECT collection_id AS c, SUM(segundos) AS s FROM tempo_aula WHERE dia = ? GROUP BY collection_id').all(desde.hoje) as any[]) {
      (porCategoria[chave(r.c)] ??= { pomodoros: 0, segundosAula: 0 }).segundosAula = r.s;
    }
    return {
      hoje: periodo(desde.hoje),
      semana: periodo(desde.semana),
      mes: periodo(desde.mes),
      total: periodo(desde.total),
      porCategoria,
    };
  });
}
