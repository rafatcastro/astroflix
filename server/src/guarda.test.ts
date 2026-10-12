import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db/index';
import { loadConfig } from './config';
import { buildApp } from './app';
import { hostConfiavel, origemConfiavel } from './guarda';

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guarda-'));
  return buildApp(loadConfig({ DATA_DIR: dir }), openDb(':memory:'));
}

describe('hostConfiavel', () => {
  it('aceita localhost e IPs literais, com ou sem porta', () => {
    for (const h of ['localhost:7777', 'localhost', '127.0.0.1:7777', '[::1]:7777', '192.168.0.10:7777', 'app.localhost:7777']) {
      expect(hostConfiavel(h)).toBe(true);
    }
  });
  // DNS rebinding precisa de um nome de domínio: é ele que chega no Host.
  it('recusa nomes de domínio e Host ausente', () => {
    for (const h of ['evil.example:7777', 'localhost.evil.example', undefined]) expect(hostConfiavel(h)).toBe(false);
  });
});

describe('origemConfiavel', () => {
  it('aceita ausente, a mesma origem e outra porta desta máquina (Vite)', () => {
    expect(origemConfiavel(undefined, 'localhost:7777')).toBe(true);
    expect(origemConfiavel('http://localhost:7777', 'localhost:7777')).toBe(true);
    expect(origemConfiavel('http://localhost:5173', 'localhost:7777')).toBe(true);
    expect(origemConfiavel('http://192.168.0.10:7777', '192.168.0.10:7777')).toBe(true);
  });
  it('recusa sites de fora, IP de outra máquina e "null"', () => {
    expect(origemConfiavel('https://evil.example', 'localhost:7777')).toBe(false);
    expect(origemConfiavel('http://203.0.113.5', 'localhost:7777')).toBe(false);
    expect(origemConfiavel('null', 'localhost:7777')).toBe(false);
  });
});

describe('guarda no app', () => {
  // O ataque que motivou a guarda: um fetch no-cors de qualquer página zerava tudo.
  it('recusa POST destrutivo vindo de outro site, mesmo sem corpo ou com text/plain', async () => {
    const app = makeApp();
    for (const headers of [{}, { 'content-type': 'text/plain' }]) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/library/reset',
        headers: { origin: 'https://evil.example', ...headers },
        payload: 'content-type' in headers ? 'x' : undefined,
      });
      expect(r.statusCode).toBe(403);
    }
  });

  it('recusa qualquer requisição com Host de outro domínio (DNS rebinding)', async () => {
    const app = makeApp();
    const leitura = await app.inject({ method: 'GET', url: '/api/settings', headers: { host: 'rebind.evil:7777' } });
    expect(leitura.statusCode).toBe(403);
    const escrita = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { host: 'rebind.evil:7777', 'content-type': 'application/json' },
      payload: JSON.stringify({ allowedRootsExtra: ['/'] }),
    });
    expect(escrita.statusCode).toBe(403);
  });

  it('deixa passar a própria interface', async () => {
    const app = makeApp();
    const r = await app.inject({
      method: 'POST',
      url: '/api/progress/reset',
      headers: { host: 'localhost:7777', origin: 'http://localhost:7777' },
    });
    expect(r.statusCode).toBe(200);
  });
});
