import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { openDb } from '../db/index';
import { createCourseFromPath } from '../scan/scan-course';
import { migrationRoutes } from './migration';
import { createCourseFromDrive } from '../scan/scan-drive';
import { loadConfig } from '../config';
import { FalhaDrive } from '../drive/tipos';
import type { ServicosDrive } from '../drive/servicos';
import type { ArquivoDrive } from '../drive/api';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(root, 'a.mp4'), 'x');
  return root;
}

describe('rotas de migração', () => {
  it('preview não altera; repoint aplica e muda root; rescan 409 sem pasta', async () => {
    const root = fixture();
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const app = Fastify();
    app.register(migrationRoutes, { db, config: { allowedRoots: [os.tmpdir()] } as any });

    const root2 = fixture();
    const prev = await app.inject({ method: 'POST', url: `/api/courses/${cid}/repoint/preview`, payload: { path: root2 } });
    expect(prev.statusCode).toBe(200);
    expect(prev.json().matched).toBe(1);
    expect((db.prepare('SELECT root_path FROM courses WHERE id=?').get(cid) as any).root_path).toBe(root); // preview não escreveu

    const apply = await app.inject({ method: 'POST', url: `/api/courses/${cid}/repoint`, payload: { path: root2 } });
    expect(apply.statusCode).toBe(200);
    expect((db.prepare('SELECT root_path FROM courses WHERE id=?').get(cid) as any).root_path).toBe(root2);

    fs.rmSync(root2, { recursive: true, force: true });
    const rescan = await app.inject({ method: 'POST', url: `/api/courses/${cid}/rescan` });
    expect(rescan.statusCode).toBe(409);
    expect(rescan.json().status).toBe('root_unavailable');

    fs.rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('preview fora das raízes → 403', async () => {
    const root = fixture();
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const app = Fastify();
    app.register(migrationRoutes, { db, config: { allowedRoots: ['/nonexistent-root'] } as any });
    const res = await app.inject({ method: 'POST', url: `/api/courses/${cid}/repoint/preview`, payload: { path: '/etc' } });
    expect(res.statusCode).toBe(403);
    fs.rmSync(root, { recursive: true, force: true });
    db.close();
  });

  describe('curso do Drive', () => {
    const arq = (id: string, name: string): ArquivoDrive => ({
      id, name, mimeType: 'video/mp4', size: '1', modifiedTime: '2024-01-01T00:00:00Z', createdTime: '2024-01-01T00:00:00Z',
    });
    async function montarDrive(listar: (id: string) => Promise<ArquivoDrive[]> | ArquivoDrive[]) {
      const db = openDb(':memory:');
      const config = loadConfig({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mig-drive-')) });
      const chaves: Array<string | null | undefined> = [];
      const drive = {
        ingestao: (rk?: string | null) => {
          chaves.push(rk);
          return {
            cliente: {
              getArquivo: async (id: string) => ({ ...arq(id, 'Curso'), mimeType: 'application/vnd.google-apps.folder' }),
              listarFilhos: async (id: string) => listar(id),
              baixar: async () => new Response(null),
            },
            fetch: (async () => new Response('img')) as typeof fetch,
            config,
            token: async () => 't',
          };
        },
      } as unknown as ServicosDrive;
      const deps = drive.ingestao('raiz/rk');
      const { id } = await createCourseFromDrive(db, deps, { folderId: 'raiz', resourceKey: 'rk' }, 'link');
      return { db, config, drive, id, chaves };
    }

    it('rescan reconcilia pelo Drive e passa a resource key', async () => {
      let itens = [arq('v1', '01 - a.mp4')];
      const { db, config, drive, id, chaves } = await montarDrive(() => itens);
      const app = Fastify();
      app.register(migrationRoutes, { db, config, drive });
      itens = [arq('v1', '01 - a.mp4'), arq('v2', '02 - b.mp4')];
      const res = await app.inject({ method: 'POST', url: `/api/courses/${id}/rescan` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ matched: 1, added: 1, missing: 0 });
      expect(chaves.at(-1)).toBe('raiz/rk');
    });

    it('repoint de curso drive → 409 curso-do-drive', async () => {
      const { db, config, drive, id } = await montarDrive(() => [arq('v1', '01 - a.mp4')]);
      const app = Fastify();
      app.register(migrationRoutes, { db, config, drive });
      for (const url of ['repoint', 'repoint/preview']) {
        const res = await app.inject({ method: 'POST', url: `/api/courses/${id}/${url}`, payload: { path: os.tmpdir() } });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'curso-do-drive' });
      }
    });

    it('sem serviços do Drive → 503 sem-conexao', async () => {
      const { db, config, id } = await montarDrive(() => [arq('v1', '01 - a.mp4')]);
      const app = Fastify();
      app.register(migrationRoutes, { db, config });
      const res = await app.inject({ method: 'POST', url: `/api/courses/${id}/rescan` });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'sem-conexao' });
    });

    it('FalhaDrive no rescan vira o status do seu tipo', async () => {
      let falhar = false;
      const { db, config, drive, id } = await montarDrive(() => {
        if (falhar) throw new FalhaDrive('sem-acesso', 403);
        return [arq('v1', '01 - a.mp4')];
      });
      const app = Fastify();
      app.register(migrationRoutes, { db, config, drive });
      falhar = true;
      const res = await app.inject({ method: 'POST', url: `/api/courses/${id}/rescan` });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'sem-acesso' });
    });
  });
});
