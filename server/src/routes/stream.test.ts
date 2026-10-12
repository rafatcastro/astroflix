import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { openDb } from '../db/index';
import { createCourseFromPath } from '../scan/scan-course';
import { streamRoutes, parseRange } from './stream';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-'));
  fs.writeFileSync(path.join(root, 'v.mp4'), 'ABCDEFGHIJ'); // 10 bytes
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('parseRange', () => {
  it('parseia bytes=2-5', () => expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 }));
  it('aberto à direita', () => expect(parseRange('bytes=3-', 10)).toEqual({ start: 3, end: 9 }));
  it('sufixo', () => expect(parseRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 }));
  it('sem header → null', () => expect(parseRange(undefined, 10)).toBeNull());
});

describe('GET stream', () => {
  it('206 + Content-Range com Range; 200 sem', async () => {
    const db = openDb(':memory:');
    const courseId = createCourseFromPath(db, root);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(courseId) as any).id;
    const app = Fastify();
    app.register(streamRoutes, { db, config: { convertedDir: '/nonexistent-converted', allowedRoots: [path.resolve(root)] } as any });

    const partial = await app.inject({ method: 'GET', url: `/api/lessons/${lid}/stream`, headers: { range: 'bytes=0-3' } });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 0-3/10');
    expect(partial.rawPayload.length).toBe(4);

    const full = await app.inject({ method: 'GET', url: `/api/lessons/${lid}/stream` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.rawPayload.length).toBe(10);
  });
});

describe('GET stream fora da pasta do curso', () => {
  // O rel_path também é gravado pelo import de backup: um "../" ali não pode
  // transformar o stream num leitor de qualquer arquivo do disco.
  it('403 quando o rel_path escapa da pasta do curso', async () => {
    const db = openDb(':memory:');
    const courseId = createCourseFromPath(db, root);
    db.prepare("UPDATE lessons SET rel_path='../../etc/hosts' WHERE course_id=?").run(courseId);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(courseId) as any).id;
    const app = Fastify();
    app.register(streamRoutes, { db, config: { convertedDir: '/nonexistent-converted', allowedRoots: ['/'] } as any });

    const r = await app.inject({ method: 'GET', url: `/api/lessons/${lid}/stream` });
    expect(r.statusCode).toBe(403);
  });

  it('403 quando a pasta do curso está fora das raízes permitidas', async () => {
    const db = openDb(':memory:');
    const courseId = createCourseFromPath(db, root);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(courseId) as any).id;
    const app = Fastify();
    app.register(streamRoutes, { db, config: { convertedDir: '/nonexistent-converted', allowedRoots: ['/outro-lugar'] } as any });

    const r = await app.inject({ method: 'GET', url: `/api/lessons/${lid}/stream` });
    expect(r.statusCode).toBe(403);
  });
});
