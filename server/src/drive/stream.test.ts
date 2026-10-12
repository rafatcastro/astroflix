import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { repassarDoDrive } from './stream';
import { FalhaDrive } from './tipos';
import type { ClienteDrive } from './api';

function appCom(baixar: ClienteDrive['baixar'], extra?: Parameters<typeof repassarDoDrive>[4]) {
  const app = Fastify();
  app.get('/v', (req, reply) => repassarDoDrive(req, reply, { baixar } as unknown as ClienteDrive, 'arq1', extra));
  return app;
}

describe('repassarDoDrive', () => {
  it('206 com Content-Range repassado', async () => {
    let rangePedido: string | undefined;
    const app = appCom(async (_id, range) => {
      rangePedido = range;
      return new Response('ABCD', {
        status: 206,
        headers: { 'content-range': 'bytes 0-3/10', 'content-length': '4', 'content-type': 'video/mp4' },
      });
    });
    const r = await app.inject({ method: 'GET', url: '/v', headers: { range: 'bytes=0-3' } });
    expect(r.statusCode).toBe(206);
    expect(rangePedido).toBe('bytes=0-3');
    expect(r.headers['content-range']).toBe('bytes 0-3/10');
    expect(r.headers['content-length']).toBe('4');
    expect(r.headers['content-type']).toBe('video/mp4');
    expect(r.headers['accept-ranges']).toBe('bytes');
    expect(r.body).toBe('ABCD');
  });

  it('extra.contentType e disposition prevalecem', async () => {
    const app = appCom(async () => new Response('x', { status: 200, headers: { 'content-type': 'application/octet-stream' } }), {
      contentType: 'application/pdf',
      disposition: 'attachment',
    });
    const r = await app.inject({ method: 'GET', url: '/v' });
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe('attachment');
  });

  it('fecha a conexão → aborta o fetch', async () => {
    let signal: AbortSignal | undefined;
    const app = appCom(async (_id, _range, s) => {
      signal = s;
      // Corpo que nunca termina: só o abort encerra.
      const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); } });
      return new Response(body, { status: 200 });
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/v' }, (res) => {
        res.once('data', () => { req.destroy(); resolve(); });
      });
      req.on('error', () => {});
    });
    for (let i = 0; i < 50 && !signal?.aborted; i++) await new Promise((r) => setTimeout(r, 20));
    expect(signal?.aborted).toBe(true);
    await app.close();
  });

  it('cota-esgotada → 429 { error }', async () => {
    const app = appCom(async () => { throw new FalhaDrive('cota-esgotada', 403); });
    const r = await app.inject({ method: 'GET', url: '/v' });
    expect(r.statusCode).toBe(429);
    expect(r.json()).toEqual({ error: 'cota-esgotada' });
  });

  it('google → 502 e sem-acesso → 403', async () => {
    const g = await appCom(async () => { throw new FalhaDrive('google', 500); }).inject({ method: 'GET', url: '/v' });
    expect(g.statusCode).toBe(502);
    const s = await appCom(async () => { throw new FalhaDrive('sem-acesso', 403); }).inject({ method: 'GET', url: '/v' });
    expect(s.statusCode).toBe(403);
  });
});
