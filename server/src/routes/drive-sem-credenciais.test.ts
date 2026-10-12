import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O build desta máquina pode embutir credenciais padrão; aqui elas somem para o
// teste valer em qualquer ambiente.
vi.mock('../bundled', async (orig) => ({
  ...(await orig<typeof import('../bundled')>()),
  GOOGLE_PADRAO: { clientId: null, clientSecret: null, apiKey: null },
}));

import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { buildApp } from '../app';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rota-drive-sc-'));
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('rotas do Drive sem credenciais', () => {
  function montar() {
    for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_API_KEY']) vi.stubEnv(k, '');
    const fetchNegado = (async () => new Response('{}', { status: 404 })) as typeof fetch;
    return buildApp(loadConfig({ DATA_DIR: tmp }), openDb(':memory:'), { fetch: fetchNegado });
  }
  const headers = { host: 'localhost:7777' };

  it('auth/iniciar → 503 sem-credenciais', async () => {
    const r = await montar().inject({ method: 'POST', url: '/api/drive/auth/iniciar', headers });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'sem-credenciais' });
  });

  it('pasta privada sem conta e sem credenciais → 503 sem-credenciais', async () => {
    const r = await montar().inject({
      method: 'POST', url: '/api/drive/courses', headers,
      payload: { link: 'https://drive.google.com/drive/folders/privada-0123456789' },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'sem-credenciais' });
  });
});
