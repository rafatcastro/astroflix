import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import { openDb } from '../db/index';
import { fsRoutes } from './fs';

let root: string;

function makeApp() {
  const db = openDb(':memory:');
  const app = Fastify();
  app.register(fsRoutes, { db, config: { allowedRoots: [root] } as any });
  return app;
}

const escrever = (rel: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-'));
  escrever('curso-plano/01 - a.mp4');
  escrever('curso-plano/apostila.pdf');
  escrever('estante/Rust/01 - Básico/01.mp4');
  escrever('estante/Go/01.mkv');
  escrever('estante/Só PDF/a.pdf');
  escrever('estante/.oculta/01.mp4');
  escrever('vazia/notas.txt');
  escrever('funda/a/b/c/d/e/01.mp4');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const inspecionar = (app: ReturnType<typeof makeApp>, p: string) =>
  app.inject({ method: 'GET', url: `/api/fs/inspect?path=${encodeURIComponent(p)}` });

describe('GET /api/fs/inspect', () => {
  it('pasta com vídeo direto nela é um curso', async () => {
    const res = await inspecionar(makeApp(), path.join(root, 'curso-plano'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ videosNaRaiz: true, subpastasComVideo: 0 });
  });

  // Ambíguo de propósito: pode ser um curso com módulos ou uma estante de cursos,
  // e quem decide é a pessoa. Pasta só de PDF e pasta oculta não contam.
  it('conta as subpastas que têm vídeo em qualquer profundidade', async () => {
    const res = await inspecionar(makeApp(), path.join(root, 'estante'));
    expect(res.json()).toEqual({ videosNaRaiz: false, subpastasComVideo: 2 });
  });

  it('pasta sem vídeo nenhum', async () => {
    const res = await inspecionar(makeApp(), path.join(root, 'vazia'));
    expect(res.json()).toEqual({ videosNaRaiz: false, subpastasComVideo: 0 });
  });

  it('recusa fora das raízes e pasta que não existe', async () => {
    const app = makeApp();
    expect((await inspecionar(app, '/etc')).statusCode).toBe(403);
    expect((await inspecionar(app, path.join(root, 'nao-existe'))).statusCode).toBe(404);
  });

  // Leitura síncrona: sem teto, escolher a home inteira travava o servidor.
  it('não desce além de 4 níveis', async () => {
    const res = await inspecionar(makeApp(), path.join(root, 'funda'));
    expect(res.json()).toEqual({ videosNaRaiz: false, subpastasComVideo: 0 });
  });
});
