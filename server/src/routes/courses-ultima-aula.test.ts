import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { openDb } from '../db/index';
import { coursesRoutes } from './courses';

// Três aulas de 100s (a terceira sem duração) para exercitar ultimaAula e progressoReal.
function montar() {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO courses (id, title, root_path, structure, created_at, updated_at) VALUES ('c','Curso','/x','flat','x','x')`,
  ).run();
  const aula = db.prepare(
    `INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, duration_sec)
     VALUES (?, 'c', ?, ?, ?, 0, 1, 1, 'mp4', 1, ?)`,
  );
  aula.run('a1', 'a1.mp4', 'Aula 1', 0, 100);
  aula.run('a2', 'a2.mp4', 'Aula 2', 1, 100);
  aula.run('a3', 'a3.mp4', 'Aula 3', 2, null);
  const prog = (id: string, pos: number, fur: number, done: number, at: string) =>
    db
      .prepare(`INSERT INTO progress (lesson_id, position_sec, furthest_sec, completed, auto_completed, updated_at) VALUES (?,?,?,?,0,?)`)
      .run(id, pos, fur, done, at);
  const app = Fastify();
  app.register(coursesRoutes, { db, config: {} as any });
  const listar = async () => (await app.inject({ method: 'GET', url: '/api/courses' })).json()[0];
  return { db, prog, listar };
}

describe('GET /api/courses: ultimaAula e progressoReal', () => {
  it('sem progresso: ultimaAula null e progressoReal 0', async () => {
    const { listar } = montar();
    const c = await listar();
    expect(c.ultimaAula).toBeNull();
    expect(c.progressoReal).toBe(0);
  });

  it('aula mais recente não concluída, com posição e duração', async () => {
    const { prog, listar } = montar();
    prog('a1', 30, 30, 0, '2026-01-01T10:00:00Z');
    prog('a2', 45, 60, 0, '2026-01-02T10:00:00Z');
    const c = await listar();
    expect(c.ultimaAula).toEqual({ id: 'a2', titulo: 'Aula 2', posicaoSec: 45, duracaoSec: 100 });
    // (30 + 60) / 200 — a3 não tem duração e fica fora da conta.
    expect(c.progressoReal).toBe(45);
  });

  it('concluída conta como 100% e não é a última aula; tudo concluído → null', async () => {
    const { prog, listar } = montar();
    prog('a1', 100, 100, 1, '2026-01-03T10:00:00Z');
    prog('a2', 20, 20, 0, '2026-01-01T10:00:00Z');
    let c = await listar();
    expect(c.ultimaAula).toMatchObject({ id: 'a2', posicaoSec: 20 });
    expect(c.progressoReal).toBe(60);

    const { prog: prog2, listar: listar2 } = montar();
    prog2('a1', 100, 100, 1, 'x');
    prog2('a2', 0, 0, 1, 'y'); // concluída sem ter assistido: vale 100%
    c = await listar2();
    expect(c.ultimaAula).toBeNull();
    expect(c.progressoReal).toBe(100);
  });

  it('nenhuma duração conhecida → progressoReal null', async () => {
    const { db, listar } = montar();
    db.prepare('UPDATE lessons SET duration_sec=NULL').run();
    expect((await listar()).progressoReal).toBeNull();
  });

  it('duas aulas em andamento: vence a mais recente, não a de maior ordem; detalhe expõe progressUpdatedAt', async () => {
    const { db, prog, listar } = montar();
    prog('a1', 10, 10, 0, '2026-02-02T10:00:00Z'); // ordem menor, mais recente
    prog('a2', 50, 50, 0, '2026-02-01T10:00:00Z');
    expect((await listar()).ultimaAula).toMatchObject({ id: 'a1', posicaoSec: 10 });
    const app = Fastify();
    app.register(coursesRoutes, { db, config: {} as any });
    const det = (await app.inject({ method: 'GET', url: '/api/courses/c' })).json();
    const aulas = det.modules.flatMap((m: any) => m.lessons);
    expect(aulas.map((a: any) => [a.id, a.progressUpdatedAt])).toEqual([
      ['a1', '2026-02-02T10:00:00Z'], ['a2', '2026-02-01T10:00:00Z'], ['a3', null],
    ]);
  });

  it('aula ausente ou não tocável não é a última aula', async () => {
    const { db, prog, listar } = montar();
    prog('a1', 10, 10, 0, '2026-02-01T10:00:00Z');
    prog('a2', 50, 50, 0, '2026-02-02T10:00:00Z');
    db.prepare("UPDATE lessons SET missing=1 WHERE id='a2'").run();
    expect((await listar()).ultimaAula).toMatchObject({ id: 'a1' });
    db.prepare("UPDATE lessons SET playable=0 WHERE id='a1'").run();
    expect((await listar()).ultimaAula).toBeNull();
  });
});
