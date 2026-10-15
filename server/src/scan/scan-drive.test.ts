import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { aguardarCapas, createCourseFromDrive, importacaoDrive, reconcileDriveCourse, type DepsIngestao } from './scan-drive';
import { FalhaDrive } from '../drive/tipos';
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
        thumbnailLink: 'https://lh3.googleusercontent.com/v1',
        videoMediaMetadata: { durationMillis: '90000' },
      }),
      arq('v2', '02 - setup.mp4', { thumbnailLink: 'https://lh3.googleusercontent.com/v2' }),
    ],
  };
  const cliente: ClienteDrive = {
    getArquivo: async (id) => (id === 'raiz' ? arq('raiz', 'Curso Drive', { mimeType: PASTA }) : arq(id, id)),
    listarFilhos: async (id) => arvore[id] ?? [],
    listar: async () => [],
    baixar: async () => new Response(null),
  };
  const config = loadConfig({ DATA_DIR: path.join(tmp, 'dados-' + Math.random().toString(36).slice(2)) });
  const deps: DepsIngestao = { cliente, fetch: fetchImpl, config, token: async () => token };
  return { deps, config, arvore, db: openDb(':memory:') };
}

const link = { folderId: 'raiz', resourceKey: 'rk1' };

describe('createCourseFromDrive', () => {
  it('não espera as capas: fetch que nunca resolve não trava a criação', async () => {
    // Liberado no fim para não deixar capa pendurada para os outros testes.
    let liberar!: () => void;
    const trava = new Promise<Response>((ok) => (liberar = () => ok(new Response('x'))));
    const { deps, db } = montar((() => trava) as unknown as typeof fetch);
    const r = await Promise.race([
      createCourseFromDrive(db, deps, link, 'l'),
      new Promise<'travou'>((ok) => setTimeout(() => ok('travou'), 500)),
    ]);
    liberar();
    await aguardarCapas();
    expect(r).not.toBe('travou');
  });

  it('reconcile também não espera as capas', async () => {
    let liberar!: () => void;
    const trava = new Promise<Response>((ok) => (liberar = () => ok(new Response('x'))));
    const { deps, db } = montar((() => trava) as unknown as typeof fetch);
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    const r = await Promise.race([
      reconcileDriveCourse(db, deps, id),
      new Promise<'travou'>((ok) => setTimeout(() => ok('travou'), 500)),
    ]);
    liberar();
    await aguardarCapas();
    expect(r).not.toBe('travou');
  });

  it('cria curso drive com módulos, remote_id e duração', async () => {
    const { deps, db } = montar((async () => new Response('img')) as typeof fetch);
    const { id, existente } = await createCourseFromDrive(db, deps, link, 'https://drive.google.com/x');
    await aguardarCapas();
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
    await aguardarCapas();
    const aulas: any[] = db.prepare('SELECT * FROM lessons WHERE course_id=?').all(id);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0][1].headers.Authorization).toBe('Bearer tok');
    for (const a of aulas) {
      expect(a.thumb_path.startsWith(config.thumbsDir)).toBe(true);
      expect(fs.readFileSync(a.thumb_path, 'utf8')).toBe('jpegbytes');
    }
  });

  it('Bearer só vai para https do Google; outros hosts baixam sem credencial', async () => {
    const chamadas: Array<[string, any]> = [];
    const { deps, db, arvore } = montar((async (u: any, init: any) => {
      chamadas.push([String(u), init]);
      return new Response('img');
    }) as typeof fetch);
    arvore.m1[0].thumbnailLink = 'https://evil.example.com/x';
    arvore.m1[1].thumbnailLink = 'http://lh3.googleusercontent.com/y';
    await createCourseFromDrive(db, deps, link, 'l');
    await aguardarCapas();
    expect(chamadas).toHaveLength(2);
    for (const [, init] of chamadas) expect(init.headers.Authorization).toBeUndefined();
  });

  it('falha de capa não impede o curso', async () => {
    let n = 0;
    const { deps, db } = montar((async () => {
      if (n++ === 0) throw new Error('rede');
      return new Response('ok');
    }) as typeof fetch);
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    await aguardarCapas();
    const aulas: any[] = db.prepare('SELECT thumb_path FROM lessons WHERE course_id=?').all(id);
    expect(aulas.filter((a) => a.thumb_path).length).toBe(1);
  });
});

describe('reconcileDriveCourse', () => {
  const imgs = (async () => new Response('img')) as typeof fetch;

  it('rescan drive: aula nova entra, sumida fica missing, progresso preservado', async () => {
    const { deps, db, arvore } = montar(imgs);
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    await aguardarCapas();
    const v1: any = db.prepare("SELECT id FROM lessons WHERE course_id=? AND rel_path LIKE '%ola%'").get(id);
    db.prepare('INSERT INTO progress (lesson_id, position_sec, furthest_sec, completed, auto_completed, updated_at) VALUES (?,?,?,?,?,?)')
      .run(v1.id, 42, 42, 0, 0, 'x');

    // v2 some, v3 entra
    arvore.m1 = [arvore.m1[0], arq('v3', '03 - extra.mp4', { thumbnailLink: 'http://thumb/v3' })];
    const r = await reconcileDriveCourse(db, deps, id);
    await aguardarCapas();
    expect(r).toMatchObject({ matched: 1, missing: 1, added: 1 });

    const aulas: any[] = db.prepare('SELECT * FROM lessons WHERE course_id=?').all(id);
    expect(aulas.find((a) => a.remote_id === 'v2').missing).toBe(1);
    const nova = aulas.find((a) => a.remote_id === 'v3');
    expect(nova.missing).toBe(0);
    expect(fs.readFileSync(nova.thumb_path, 'utf8')).toBe('img');
    const p: any = db.prepare('SELECT position_sec FROM progress WHERE lesson_id=?').get(v1.id);
    expect(p.position_sec).toBe(42);
  });

  it('rescan drive atualiza remote_id de arquivo re-enviado com o mesmo nome', async () => {
    const { deps, db, arvore } = montar(imgs);
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    await aguardarCapas();
    const antes: any = db.prepare("SELECT id FROM lessons WHERE remote_id='v2'").get();
    arvore.m1 = [arvore.m1[0], arq('v2-novo', '02 - setup.mp4', { videoMediaMetadata: { durationMillis: '5000' } })];
    await reconcileDriveCourse(db, deps, id);
    const depois: any = db.prepare("SELECT * FROM lessons WHERE id=?").get(antes.id);
    expect(depois.remote_id).toBe('v2-novo');
    expect(depois.duration_sec).toBe(5);
    expect(depois.missing).toBe(0);
  });

  it('pasta já adicionada: devolve existente, reconcilia e desarquiva', async () => {
    const { deps, db } = montar(imgs);
    const a = await createCourseFromDrive(db, deps, link, 'l');
    db.prepare('UPDATE courses SET archived=1 WHERE id=?').run(a.id);
    const b = await createCourseFromDrive(db, deps, link, 'l');
    expect(b).toEqual({ id: a.id, existente: true });
    expect((db.prepare('SELECT archived FROM courses WHERE id=?').get(a.id) as any).archived).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM courses').get() as any).n).toBe(1);
  });

  // Colar o link não pode esperar a pasta inteira: o curso nasce com a raiz e as
  // aulas entram enquanto as subpastas são listadas.
  it('volta antes de listar as subpastas e as aulas vão entrando', async () => {
    const { deps, db } = montar(imgs);
    let soltar!: () => void;
    const portao = new Promise<void>((ok) => { soltar = ok; });
    const listar = deps.cliente.listarFilhos;
    deps.cliente.listarFilhos = async (id) => {
      if (id === 'm1') await portao;
      return listar(id);
    };

    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    const aulas = () => (db.prepare('SELECT COUNT(*) n FROM lessons WHERE course_id=?').get(id) as any).n;
    expect((db.prepare('SELECT title FROM courses WHERE id=?').get(id) as any).title).toBe('Curso Drive');
    expect(importacaoDrive(id)).toEqual({ carregando: true, erro: null });
    expect(aulas()).toBe(0);

    soltar();
    await aguardarCapas();
    expect(aulas()).toBe(2);
    expect(importacaoDrive(id)).toEqual({ carregando: false, erro: null });
  });

  it('erro na raiz volta na hora (o modal mostra); erro no meio fica no estado do curso', async () => {
    const { deps, db } = montar(imgs);
    const original = deps.cliente.getArquivo;
    deps.cliente.getArquivo = async () => { throw new FalhaDrive('sem-acesso'); };
    await expect(createCourseFromDrive(db, deps, link, 'l')).rejects.toMatchObject({ tipo: 'sem-acesso' });
    expect((db.prepare('SELECT COUNT(*) n FROM courses').get() as any).n).toBe(0);

    deps.cliente.getArquivo = original;
    deps.cliente.listarFilhos = async (pasta) => {
      if (pasta === 'm1') throw new FalhaDrive('cota-esgotada');
      return [arq('m1', 'Modulo 1', { mimeType: PASTA })];
    };
    const { id } = await createCourseFromDrive(db, deps, link, 'l');
    await aguardarCapas();
    expect(importacaoDrive(id)).toEqual({ carregando: false, erro: 'cota-esgotada' });
  });
});
