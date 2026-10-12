import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { openDb } from '../db/index';
import { createCourseFromPath } from '../scan/scan-course';
import { materialsRoutes } from './materials';
import { FalhaDrive } from '../drive/tipos';
import { semearCursoDrive, servicosFalsos } from '../drive/teste-helpers';

let root: string;

function makeApp(db: any) {
  const app = Fastify();
  app.register(materialsRoutes, { db, config: { allowedRoots: [root] } as any });
  return app;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-'));
  fs.mkdirSync(path.join(root, 'curso', 'Mod 1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'curso', 'Mod 1', 'aula.mp4'), 'v');
  fs.writeFileSync(path.join(root, 'curso', 'Mod 1', 'apostila.pdf'), '%PDF-1.4 conteudo');
  fs.writeFileSync(path.join(root, 'curso', 'material.zip'), 'PKzip');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('materials route', () => {
  it('serve PDF inline com content-type e o detalhe do curso lista os materiais', async () => {
    const db = openDb(':memory:');
    createCourseFromPath(db, path.join(root, 'curso'));
    const pdf = db.prepare("SELECT id FROM materials WHERE rel_path LIKE '%apostila.pdf'").get() as { id: string };
    const zip = db.prepare("SELECT id FROM materials WHERE rel_path LIKE '%material.zip'").get() as { id: string };
    expect(pdf?.id).toBeTruthy();

    const app = makeApp(db);
    const r = await app.inject({ method: 'GET', url: `/api/materials/${pdf.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('inline');
    expect(r.body).toContain('%PDF');

    // zip vai como download (attachment) mesmo sem ?download
    const z = await app.inject({ method: 'GET', url: `/api/materials/${zip.id}` });
    expect(z.headers['content-type']).toBe('application/zip');
    expect(z.headers['content-disposition']).toContain('attachment');

    // ?download=1 força attachment no PDF também
    const dl = await app.inject({ method: 'GET', url: `/api/materials/${pdf.id}?download=1` });
    expect(dl.headers['content-disposition']).toContain('attachment');
  });

  it('404 para material inexistente', async () => {
    const db = openDb(':memory:');
    const app = makeApp(db);
    expect((await app.inject({ method: 'GET', url: '/api/materials/nao-existe' })).statusCode).toBe(404);
  });
});

describe('materials route — SVG', () => {
  // Servido na mesma origem da API: aberto direto na aba, o <script> de um SVG
  // baixado de qualquer lugar rodaria com acesso a tudo.
  it('serve SVG com CSP sandbox e nosniff', async () => {
    fs.writeFileSync(path.join(root, 'curso', 'diagrama.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const db = openDb(':memory:');
    createCourseFromPath(db, path.join(root, 'curso'));
    const svg = db.prepare("SELECT id FROM materials WHERE rel_path='diagrama.svg'").get() as { id: string };

    const r = await makeApp(db).inject({ method: 'GET', url: `/api/materials/${svg.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-security-policy']).toContain('sandbox');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('materials route — Drive', () => {
  it('material drive sai como attachment com download=1', async () => {
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const drive = servicosFalsos(async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    const app = Fastify();
    app.register(materialsRoutes, { db, config: { allowedRoots: [] } as any, drive });

    const dl = await app.inject({ method: 'GET', url: '/api/materials/md?download=1' });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain("attachment; filename*=UTF-8''apostila.pdf");
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');

    const inline = await app.inject({ method: 'GET', url: '/api/materials/md' });
    expect(inline.headers['content-disposition']).toContain('inline');
  });

  it('material: sem-acesso com conta desconectada → 401 nao-autorizado', async () => {
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const app = Fastify();
    app.register(materialsRoutes, {
      db, config: { allowedRoots: [] } as any,
      drive: servicosFalsos(async () => { throw new FalhaDrive('nao-autorizado', 401); }, undefined, false),
    });
    const r = await app.inject({ method: 'GET', url: '/api/materials/md' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'nao-autorizado' });
  });
});
