import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { buildApp } from '../app';
import { salvarCredenciais } from '../drive/credenciais';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rota-drive-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PASTA = 'application/vnd.google-apps.folder';
const ID = 'pasta-publica-1234';
const LINK = `https://drive.google.com/drive/folders/${ID}`;

function arq(id: string, name: string, mimeType = 'video/mp4') {
  return { id, name, mimeType, size: '10', modifiedTime: '2024-01-01T00:00:00Z', createdTime: '2024-01-01T00:00:00Z' };
}

// Fetch falso do Google: pasta pública responde; qualquer outra é 404 (o Drive
// responde 404 para o que a conta não enxerga). Nada sai da máquina.
function fetchFalso(chamadas: string[] = []): typeof fetch {
  return (async (input: any) => {
    const u = new URL(String(input));
    chamadas.push(u.toString());
    if (u.hostname === 'oauth2.googleapis.com') {
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }
    const m = /\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      return m[1] === ID ? Response.json(arq(ID, 'Curso Público', PASTA)) : new Response('{}', { status: 404 });
    }
    if (u.pathname.endsWith('/files')) {
      const q = u.searchParams.get('q') ?? '';
      return Response.json({ files: q.includes(`'${ID}'`) ? [arq('v1', '01 - ola.mp4')] : [] });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

function montar(f: typeof fetch = fetchFalso()) {
  const db = openDb(':memory:');
  const config = loadConfig({ DATA_DIR: path.join(tmp, 'd' + Math.random().toString(36).slice(2)) });
  const app = buildApp(config, db, { fetch: f });
  return { app, db };
}

const post = (app: any, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as any, headers: { host: 'localhost:7777', ...headers } });

describe('rotas do Drive', () => {
  it('link inválido → 400', async () => {
    const { app } = montar();
    const r = await post(app, '/api/drive/courses', { link: 'https://exemplo.com/x' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'link-invalido' });
    expect((await post(app, '/api/drive/courses', {})).statusCode).toBe(400);
  });

  it('pasta pública → 201 e curso com source drive', async () => {
    const { app, db } = montar();
    const r = await post(app, '/api/drive/courses', { link: LINK });
    expect(r.statusCode).toBe(201);
    const { id, existente } = r.json();
    expect(existente).toBe(false);
    expect((db.prepare('SELECT source FROM courses WHERE id=?').get(id) as any).source).toBe('drive');
  });

  it('mesmo link duas vezes → mesmo id, existente:true, um curso só', async () => {
    const { app, db } = montar();
    const a = await post(app, '/api/drive/courses', { link: LINK });
    const b = await post(app, '/api/drive/courses', { link: `${LINK}?usp=sharing` });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ id: a.json().id, existente: true });
    expect((db.prepare('SELECT COUNT(*) AS n FROM courses').get() as any).n).toBe(1);
  });

  it('privada sem login → 401 precisaAutorizar com url do Google e redirect no host da requisição', async () => {
    const { app, db } = montar();
    salvarCredenciais(db, { clientId: 'cid' });
    const r = await post(app, '/api/drive/courses', { link: 'https://drive.google.com/drive/folders/privada-0123456789' }, { host: '127.0.0.1:9999' });
    expect(r.statusCode).toBe(401);
    const { precisaAutorizar, url } = r.json();
    expect(precisaAutorizar).toBe(true);
    const u = new URL(url);
    expect(u.hostname).toBe('accounts.google.com');
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999/api/drive/auth/callback');
  });

  it('privada com login → 403 sem-acesso', async () => {
    const { app, db } = montar();
    salvarCredenciais(db, { clientId: 'cid' });
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.refresh_token', 'r')").run();
    const r = await post(app, '/api/drive/courses', { link: 'https://drive.google.com/drive/folders/privada-0123456789' });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: 'sem-acesso' });
  });

  it('cota-esgotada → 429 (sem-conexao → 503 vem do statusDaFalha, coberto em status.test)', async () => {
    const cota = montar((async () => Response.json({ error: { errors: [{ reason: 'downloadQuotaExceeded' }] } }, { status: 403 })) as any);
    expect((await post(cota.app, '/api/drive/courses', { link: LINK })).statusCode).toBe(429);
  });

  it('iniciar devolve a url do Google', async () => {
    const { app, db } = montar();
    salvarCredenciais(db, { clientId: 'cid' });
    const r = await post(app, '/api/drive/auth/iniciar', {});
    expect(r.statusCode).toBe(200);
    expect(new URL(r.json().url).searchParams.get('redirect_uri')).toBe('http://localhost:7777/api/drive/auth/callback');
  });

  it('callback com state inválido devolve página que avisa ok:false', async () => {
    const { app } = montar();
    const r = await app.inject({
      method: 'GET',
      url: '/api/drive/auth/callback?state=<script>alert(1)</script>&code=SEGREDO',
      headers: { host: 'localhost:7777' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.body).toContain('"ok":false');
    expect(r.body).toContain('"motivo":"state-invalido"');
    expect(r.body).toContain('learnflix-drive');
    expect(r.body).not.toContain('SEGREDO');
    expect(r.body).not.toContain('alert(1)');
    const csp = String(r.headers['content-security-policy']);
    const nonce = /nonce-([\w-]+)/.exec(csp)?.[1];
    expect(csp).toContain("default-src 'none'");
    expect(nonce).toBeTruthy();
    expect(r.body).toContain(`nonce="${nonce}"`);
  });

  it('status nunca devolve o token nem os valores das credenciais', async () => {
    const { app, db } = montar();
    salvarCredenciais(db, { clientId: 'ID-SECRETO', clientSecret: 'SEGREDO-X', apiKey: 'CHAVE-Y' });
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.refresh_token', 'REFRESH-Z')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.email', 'a@b.com')").run();
    const r = await app.inject({ method: 'GET', url: '/api/drive/status', headers: { host: 'localhost:7777' } });
    expect(r.json()).toEqual({
      conectado: true, email: 'a@b.com', credenciais: { clientId: true, clientSecret: true, apiKey: true },
    });
    for (const v of ['ID-SECRETO', 'SEGREDO-X', 'CHAVE-Y', 'REFRESH-Z']) expect(r.body).not.toContain(v);
  });

  it('PUT credenciais salva só strings conhecidas; DELETE auth → 204', async () => {
    const { app, db } = montar();
    const put = (payload: unknown) =>
      app.inject({ method: 'PUT', url: '/api/drive/credenciais', payload: payload as any, headers: { host: 'localhost:7777' } });
    expect((await put({ clientId: 'abc', apiKey: 5, extra: 'x' })).statusCode).toBe(204);
    const salvo = JSON.parse((db.prepare("SELECT value FROM settings WHERE key='drive.credenciais'").get() as any).value);
    expect(salvo).toEqual({ clientId: 'abc' });
    expect((await put([1])).statusCode).toBe(400);
    expect((await put(undefined)).statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: '/api/drive/auth', headers: { host: 'localhost:7777' } });
    expect(del.statusCode).toBe(204);
  });

  it('POST /api/drive/courses de outra origem → recusado pela guarda', async () => {
    const { app, db } = montar();
    const r = await post(app, '/api/drive/courses', { link: LINK }, { origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
    expect((db.prepare('SELECT COUNT(*) AS n FROM courses').get() as any).n).toBe(0);
  });

  it('GET /api/courses/:id inclui source (e a lista também)', async () => {
    const { app } = montar();
    const { id } = (await post(app, '/api/drive/courses', { link: LINK })).json();
    const d = await app.inject({ method: 'GET', url: `/api/courses/${id}`, headers: { host: 'localhost:7777' } });
    expect(d.json().source).toBe('drive');
    const l = await app.inject({ method: 'GET', url: '/api/courses', headers: { host: 'localhost:7777' } });
    expect(l.json()[0].source).toBe('drive');
  });
});
