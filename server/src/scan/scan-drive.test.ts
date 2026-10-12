import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { createCourseFromDrive, type DepsIngestao } from './scan-drive';
import type { ArquivoDrive, ClienteDrive } from '../drive/api';

const PASTA = 'application/vnd.google-apps.folder';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-drive-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function arq(id: string, name: string, extra: Partial<ArquivoDrive> = {}): ArquivoDrive {
  return {
    id, name, mimeType: 'video/mp4', size: '10', modifiedTime: '2024-01-01T00:00:00Z',
    createdTime: '2024-01-01T00:00:00Z', ...extra,
  };
}

function montar(fetchImpl: typeof fetch, token: string | null = 'tok') {
  const arvore: Record<string, ArquivoDrive[]> = {
    raiz: [
      arq('m1', 'Modulo 1', { mimeType: PASTA }),
      arq('pdf', 'guia.pdf', { mimeType: 'application/pdf' }),
    ],
    m1: [
      arq('v1', '01 - ola.mp4', {
        thumbnailLink: 'http://thumb/v1',
        videoMediaMetadata: { durationMillis: '90000' },
      }),
      arq('v2', '02 - setup.mp4', { thumbnailLink: 'http://thumb/v2' }),
    ],
  };
  const cliente: ClienteDrive = {
    getArquivo: async (id) => (id === 'raiz' ? arq('raiz', 'Curso Drive', { mimeType: PASTA }) : arq(id, id)),
    listarFilhos: async (id) => arvore[id] ?? [],
    baixar: async () => new Response(null),
  };
  const config = loadConfig({ DATA_DIR: path.join(tmp, 'dados-' + Math.random().toString(36).slice(2)) });
  const deps: DepsIngestao = { cliente, fetch: fetchImpl, config, token: async () => token };
  return { deps, config, db: openDb(':memory:') };
}

const link = { folderId: 'raiz', resourceKey: 'rk1' };

describe('createCourseFromDrive', () => {
  it('cria curso drive com módulos, remote_id e duração', async () => {
    const { deps, db } = montar((async () => new Response('img')) as typeof fetch);
    const { id, existente } = await createCourseFromDrive(db, deps, link, 'https://drive.google.com/x');
    expect(existente).toBe(false);
    const c: any = db.prepare('SELECT * FROM courses WHERE id=?').get(id);
    expect(c).toMatchObject({
      source: 'drive', drive_folder_id: 'raiz', drive_resource_key: 'rk1',
      root_path: 'https://drive.google.com/x', title: 'Curso Drive', structure: 'modules',
    });
    const aulas: any[] = db.prepare('SELECT * FROM lessons WHERE course_id=? ORDER BY order_index').all(id);
    expect(aulas.map((a) => [a.remote_id, a.duration_sec, a.module])).toEqual([
      ['v1', 90, 'Modulo 1'], ['v2', null, 'Modulo 1'],
    ]);
    expect(c.poster_lesson_id).toBe(aulas[0].id);
    const mats: any[] = db.prepare('SELECT * FROM materials WHERE course_id=?').all(id);
    expect(mats.map((m) => m.remote_id)).toEqual(['pdf']);
  });

  it('capa baixada vai para thumbs e grava thumb_path', async () => {
    const chamadas: Array<[string, any]> = [];
    const { deps, db, config } = montar((async (u: any, init: any) => {
      chamadas.push([String(u), init]);
      return new Response('jpegbytes');
    }) as typeof fetch);
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    const aulas: any[] = db.prepare('SELECT * FROM lessons WHERE course_id=?').all(id);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0][1].headers.Authorization).toBe('Bearer tok');
    for (const a of aulas) {
      expect(a.thumb_path.startsWith(config.thumbsDir)).toBe(true);
      expect(fs.readFileSync(a.thumb_path, 'utf8')).toBe('jpegbytes');
    }
  });

  it('falha de capa não impede o curso', async () => {
    let n = 0;
    const { deps, db } = montar((async () => {
      if (n++ === 0) throw new Error('rede');
      return new Response('ok');
    }) as typeof fetch);
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    const aulas: any[] = db.prepare('SELECT thumb_path FROM lessons WHERE course_id=?').all(id);
    expect(aulas.filter((a) => a.thumb_path).length).toBe(1);
  });
});
