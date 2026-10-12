import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { openDb } from '../db/index';
import { createCourseFromPath } from '../scan/scan-course';
import { lessonThumbPath } from '../media/thumbs';
import { infoRoutes } from './info';
import { thumbsRoutes } from './thumbs';
import { semearCursoDrive } from '../drive/teste-helpers';
import type { ServicosDrive } from '../drive/servicos';

describe('GET /api/info', () => {
  it('retorna { ffmpeg: boolean }', async () => {
    const app = Fastify();
    app.register(infoRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/info' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().ffmpeg).toBe('boolean');
  });
});

describe('rotas thumb/cover (cache-hit, sem ffmpeg)', () => {
  it('thumb do cache → 200 webp; cover faz fallback p/ aula-pôster; inexistente → 404', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    fs.writeFileSync(path.join(root, 'a.mp4'), 'xx');
    const thumbsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
    const config = { thumbsDir } as any;
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const lesson = db.prepare('SELECT id, mtime FROM lessons WHERE course_id=?').get(cid) as any;
    fs.writeFileSync(lessonThumbPath(config, lesson.id, lesson.mtime), 'WEBP'); // pré-posiciona cache

    const app = Fastify();
    app.register(thumbsRoutes, { db, config });

    const t = await app.inject({ method: 'GET', url: `/api/lessons/${lesson.id}/thumb` });
    expect(t.statusCode).toBe(200);
    expect(t.headers['content-type']).toBe('image/jpeg');

    const cover = await app.inject({ method: 'GET', url: `/api/courses/${cid}/cover` });
    expect(cover.statusCode).toBe(200); // poster_lesson_id = lesson → cache-hit

    const missing = await app.inject({ method: 'GET', url: `/api/lessons/nope/thumb` });
    expect(missing.statusCode).toBe(404);

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(thumbsDir, { recursive: true, force: true });
    db.close();
  });
});

describe('thumb/cover de curso do Drive', () => {
  it('thumb sem arquivo no cache → 404 sem chamar ffmpeg; com cache → 200', async () => {
    const thumbsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
    const config = { thumbsDir } as any;
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const app = Fastify();
    app.register(thumbsRoutes, { db, config });
    expect((await app.inject({ method: 'GET', url: '/api/lessons/ld/thumb' })).statusCode).toBe(404);
    fs.writeFileSync(lessonThumbPath(config, 'ld', 1), 'JPG');
    expect((await app.inject({ method: 'GET', url: '/api/lessons/ld/thumb' })).statusCode).toBe(200);
    fs.rmSync(thumbsDir, { recursive: true, force: true });
  });

  // Serviços falsos: getArquivo devolve um thumbnailLink novo; fetch serve a imagem.
  function servicosComCapa(config: any, opts: { falhar?: boolean } = {}) {
    const chamadas = { getArquivo: 0, fetch: 0 };
    const servicos = {
      ingestao: () => ({
        config,
        token: async () => 'tok',
        cliente: {
          getArquivo: async () => {
            chamadas.getArquivo++;
            return { id: 'arq-video', name: 'aula.mp4', mimeType: 'video/mp4', thumbnailLink: 'https://lh3.googleusercontent.com/novo' };
          },
        },
        fetch: async () => {
          chamadas.fetch++;
          await new Promise((r) => setTimeout(r, 20));
          return opts.falhar ? new Response('x', { status: 403 }) : new Response('JPGNOVO');
        },
      }),
    } as unknown as ServicosDrive;
    return { servicos, chamadas };
  }

  it('capa sob demanda: baixa uma vez (mesmo em paralelo) e serve do cache depois', async () => {
    const thumbsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
    const config = { thumbsDir } as any;
    const db = openDb(':memory:');
    semearCursoDrive(db);
    db.prepare("UPDATE courses SET poster_lesson_id='ld' WHERE id='cd'").run();
    const { servicos, chamadas } = servicosComCapa(config);
    const app = Fastify();
    app.register(thumbsRoutes, { db, config, drive: servicos });
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/lessons/ld/thumb' }),
      app.inject({ method: 'GET', url: '/api/lessons/ld/thumb' }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.body).toBe('JPGNOVO');
    const c = await app.inject({ method: 'GET', url: '/api/courses/cd/cover' });
    expect(c.statusCode).toBe(200);
    expect(chamadas).toEqual({ getArquivo: 1, fetch: 1 });
    expect((db.prepare("SELECT thumb_path FROM lessons WHERE id='ld'").get() as any).thumb_path).toBe(lessonThumbPath(config, 'ld', 1));
    fs.rmSync(thumbsDir, { recursive: true, force: true });
  });

  it('falha ao buscar a capa → 404 no_thumb, não 500', async () => {
    const thumbsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
    const config = { thumbsDir } as any;
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const app = Fastify();
    app.register(thumbsRoutes, { db, config, drive: servicosComCapa(config, { falhar: true }).servicos });
    const r = await app.inject({ method: 'GET', url: '/api/lessons/ld/thumb' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'no_thumb' });
    fs.rmSync(thumbsDir, { recursive: true, force: true });
  });

  it('escolher quadro da capa de curso drive → 409', async () => {
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const app = Fastify();
    app.register(thumbsRoutes, { db, config: { thumbsDir: '/x' } as any });
    const r = await app.inject({ method: 'POST', url: '/api/courses/cd/cover', payload: { lessonId: 'ld', atSec: 3 } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'curso-do-drive' });
  });
});
