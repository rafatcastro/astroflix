import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { buildApp } from '../app';
import { BLOCO } from '../telegram/blocos';
import type { ClienteTelegram } from '../telegram/cliente';
import type { ServicosTelegram } from '../telegram/servicos';
import { FalhaTelegram, type MensagemTelegram } from '../telegram/tipos';
import { aguardarCapasTelegram } from '../scan/scan-telegram';
import { arquivoBaixadoDaAula } from '../drive/local';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rota-tg-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Arquivo falso de 3 blocos e meio: byte i vale i % 251, para conferir que o
// Range devolve exatamente os bytes pedidos, mesmo cruzando blocos.
const TAMANHO = BLOCO * 3 + 1000;
const byte = (i: number) => i % 251;
const PEER = { tipo: 'canal' as const, id: '555', accessHash: '1' };
const MSGS: MensagemTelegram[] = [
  { id: 10, data: 1_700_000_000, legenda: 'Aula 1', midia: { tipo: 'video', nome: 'a.mp4', tamanho: TAMANHO, mime: 'video/mp4', duracaoSec: 60, temMiniatura: false } },
  { id: 11, data: 1_700_000_001, legenda: '', midia: { tipo: 'documento', nome: 'apostila.pdf', tamanho: 2000, mime: 'application/pdf', duracaoSec: null, temMiniatura: false } },
];

function montar(opts: { conectado?: boolean; convite?: 'convite' | 'ja-membro' } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'd-'));
  const config = loadConfig({ DATA_DIR: dir, ALLOWED_ROOTS: dir });
  fs.mkdirSync(config.thumbsDir, { recursive: true });
  const db = openDb(path.join(dir, 'app.db'));
  const pedidos: number[] = [];
  const cliente: ClienteTelegram = {
    resolver: async (l) => {
      if (l.tipo === 'publico' && l.usuario === 'fechado') throw new FalhaTelegram('sem-acesso');
      return { peer: PEER, titulo: 'Curso' };
    },
    verConvite: async () =>
      opts.convite === 'ja-membro' ? { tipo: 'ja-membro', grupo: { peer: PEER, titulo: 'Curso' } } : { tipo: 'convite', titulo: 'Grupo Secreto' },
    entrarPorConvite: async () => ({ peer: PEER, titulo: 'Curso' }),
    mensagens: async () => MSGS,
    async *baixar(_p, msgId, offset) {
      if (msgId === 99) throw new FalhaTelegram('removido');
      pedidos.push(offset);
      const total = msgId === 11 ? 2000 : TAMANHO;
      for (let o = offset; o < total; o += BLOCO) {
        const n = Math.min(BLOCO, total - o);
        yield Buffer.from(Array.from({ length: n }, (_, i) => byte(o + i)));
      }
    },
    miniatura: async () => null,
  };
  let desconectou = 0;
  const telegram = {
    status: () => ({ conectado: opts.conectado ?? true, usuario: '@eu', credenciais: { apiId: true, apiHash: true } }),
    aoTrocarCredenciais: async () => {
      desconectou++;
    },
    cliente: async () => {
      if (opts.conectado === false) throw new FalhaTelegram('nao-autorizado');
      return cliente;
    },
  } as unknown as ServicosTelegram;
  const app = buildApp(config, db, { telegram });
  return { app, db, config, pedidos, desconexoes: () => desconectou };
}

const post = (app: any, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, payload, headers: { host: 'localhost:7777' } });

describe('rotas do Telegram', () => {
  it('link inválido → 400; sem conta → 401 precisaConectar', async () => {
    expect((await post(montar().app, '/api/telegram/courses', { link: 'https://exemplo.com' })).statusCode).toBe(400);
    const r = await post(montar({ conectado: false }).app, '/api/telegram/courses', { link: 't.me/cursoaberto' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ precisaConectar: true });
  });

  it('cria o curso (201) e, de novo, devolve o mesmo (200)', async () => {
    const { app, db } = montar();
    const a = await post(app, '/api/telegram/courses', { link: 'https://t.me/cursoaberto' });
    expect(a.statusCode).toBe(201);
    const b = await post(app, '/api/telegram/courses', { link: 't.me/cursoaberto' });
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM materials').get()).toEqual({ n: 1 });
    await aguardarCapasTelegram();
  });

  it('grupo inacessível → 403 sem-acesso', async () => {
    const r = await post(montar().app, '/api/telegram/courses', { link: 't.me/fechado' });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: 'sem-acesso' });
  });

  it('convite: pergunta antes de entrar (409); já membro cria direto; /convite entra e cria', async () => {
    const r = await post(montar().app, '/api/telegram/courses', { link: 'https://t.me/+abcDEF' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ convite: true, titulo: 'Grupo Secreto' });
    expect((await post(montar({ convite: 'ja-membro' }).app, '/api/telegram/courses', { link: 't.me/+abc' })).statusCode).toBe(201);
    expect((await post(montar().app, '/api/telegram/convite', { link: 't.me/+abc' })).statusCode).toBe(201);
    expect((await post(montar().app, '/api/telegram/convite', { link: 't.me/publico' })).statusCode).toBe(400);
  });

  it('stream: Range no meio, cruzando blocos, devolve exatamente os bytes pedidos', async () => {
    const { app, db, pedidos } = montar();
    await post(app, '/api/telegram/courses', { link: 't.me/cursoaberto' });
    const aula = (db.prepare("SELECT id FROM lessons WHERE remote_id='10'").get() as { id: string }).id;
    const start = BLOCO + 500;
    const end = BLOCO * 2 + 99;
    const r = await app.inject({ method: 'GET', url: `/api/lessons/${aula}/stream`, headers: { host: 'localhost:7777', range: `bytes=${start}-${end}` } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-range']).toBe(`bytes ${start}-${end}/${TAMANHO}`);
    expect(Number(r.headers['content-length'])).toBe(end - start + 1);
    const corpo = r.rawPayload;
    expect(corpo.length).toBe(end - start + 1);
    expect([...corpo.subarray(0, 3)]).toEqual([byte(start), byte(start + 1), byte(start + 2)]);
    expect(corpo[corpo.length - 1]).toBe(byte(end));
    expect(pedidos).toEqual([BLOCO]);
  });

  it('stream: aula apagada do grupo → 404 removido; Range fora do arquivo → 416', async () => {
    const { app, db } = montar();
    await post(app, '/api/telegram/courses', { link: 't.me/cursoaberto' });
    const aula = (db.prepare("SELECT id FROM lessons WHERE remote_id='10'").get() as { id: string }).id;
    const r416 = await app.inject({ method: 'GET', url: `/api/lessons/${aula}/stream`, headers: { host: 'localhost:7777', range: `bytes=${TAMANHO + 5}-` } });
    expect(r416.statusCode).toBe(416);
    db.prepare("UPDATE lessons SET remote_id='99' WHERE id=?").run(aula);
    const r = await app.inject({ method: 'GET', url: `/api/lessons/${aula}/stream`, headers: { host: 'localhost:7777', range: 'bytes=0-' } });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'removido' });
  });

  it('material: baixa inteiro, com o nome original (sem o prefixo do id)', async () => {
    const { app, db } = montar();
    await post(app, '/api/telegram/courses', { link: 't.me/cursoaberto' });
    const m = (db.prepare('SELECT id FROM materials').get() as { id: string }).id;
    const r = await app.inject({ method: 'GET', url: `/api/materials/${m}?download=1`, headers: { host: 'localhost:7777' } });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.length).toBe(2000);
    expect(r.headers['content-disposition']).toBe("attachment; filename*=UTF-8''apostila.pdf");
  });

  it('credenciais: api_id inválido → 400 sem mexer em nada; desconecta só quando a credencial muda', async () => {
    const { app, db, desconexoes } = montar();
    const put = (payload: unknown) =>
      app.inject({ method: 'PUT', url: '/api/telegram/credenciais', payload: payload as any, headers: { host: 'localhost:7777' } });
    expect((await put({ apiId: 'abc' })).statusCode).toBe(400);
    expect(db.prepare("SELECT value FROM settings WHERE key='telegram.credenciais'").get()).toBeUndefined();
    expect(desconexoes()).toBe(0);
    expect((await put({ apiId: '42', apiHash: 'h' })).statusCode).toBe(200);
    expect(desconexoes()).toBe(1);
    expect((await put({ apiId: 42 })).statusCode).toBe(200);
    expect(desconexoes()).toBe(1);
  });

  it('re-escanear passa pelo Telegram; re-apontar é recusado', async () => {
    const { app } = montar();
    const { id } = (await post(app, '/api/telegram/courses', { link: 't.me/cursoaberto' })).json();
    expect((await post(app, `/api/courses/${id}/rescan`, {})).statusCode).toBe(200);
    const rp = await post(app, `/api/courses/${id}/repoint`, { path: '/tmp' });
    expect(rp.statusCode).toBe(409);
    expect(rp.json()).toEqual({ error: 'curso-do-telegram' });
    const curso = await app.inject({ method: 'GET', url: `/api/courses/${id}`, headers: { host: 'localhost:7777' } });
    expect(curso.json().source).toBe('telegram');
  });

  // Sem Premium o Telegram é lento, e cada seek pedia blocos de novo: a aula
  // aberta é baixada e passa a tocar do disco.
  it('abrir a aula baixa o vídeo, e o stream passa a sair do disco', async () => {
    const { app, db, config, pedidos } = montar();
    const curso = (await post(app, '/api/telegram/courses', { link: 't.me/cursoaberto' })).json();
    const aula = db.prepare('SELECT id, rel_path FROM lessons WHERE course_id=?').get(curso.id) as { id: string; rel_path: string };
    const destino = arquivoBaixadoDaAula(config, curso.id, aula.id, aula.rel_path);

    await app.inject({ method: 'GET', url: `/api/lessons/${aula.id}` });
    await vi.waitFor(() => expect(fs.existsSync(destino)).toBe(true));
    expect(fs.statSync(destino).size).toBe(TAMANHO);

    const antes = pedidos.length;
    const r = await app.inject({ method: 'GET', url: `/api/lessons/${aula.id}/stream`, headers: { range: `bytes=${BLOCO - 2}-${BLOCO + 1}` } });
    expect(r.statusCode).toBe(206);
    expect([...r.rawPayload]).toEqual([BLOCO - 2, BLOCO - 1, BLOCO, BLOCO + 1].map(byte));
    expect(pedidos.length).toBe(antes);
  });
});
