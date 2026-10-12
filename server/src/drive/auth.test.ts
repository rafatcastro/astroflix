import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { openDb } from '../db/index';
import { criarAuthDrive, ESCOPOS } from './auth';
import { FalhaDrive, type CredenciaisGoogle } from './tipos';

const CRED: CredenciaisGoogle = { clientId: 'cid', clientSecret: 'csec', apiKey: null };
const REDIRECT = 'http://127.0.0.1:7777/api/drive/auth/callback';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Chamada = { url: string; body: URLSearchParams };

function montar(respostas: Array<() => Response | Promise<Response>>, cred = CRED) {
  const db = openDb(':memory:');
  const chamadas: Chamada[] = [];
  let agora = 1_000_000;
  const fetch = (async (url: any, init?: any) => {
    chamadas.push({ url: String(url), body: new URLSearchParams(String(init?.body ?? '')) });
    const r = respostas.shift();
    if (!r) throw new Error('fetch inesperado');
    return r();
  }) as typeof globalThis.fetch;
  const auth = criarAuthDrive({ db, fetch, credenciais: () => cred, agora: () => agora });
  const setting = (k: string) =>
    (db.prepare('SELECT value FROM settings WHERE key=?').get(k) as { value: string } | undefined)?.value;
  return { db, auth, chamadas, setting, avancar: (ms: number) => (agora += ms) };
}

const stateDe = (url: string) => new URL(url).searchParams.get('state')!;
const idToken = (email: string) => `x.${b64u({ email })}.y`;

describe('criarAuthDrive', () => {
  it('iniciar gera URL com PKCE S256, state e os três escopos', () => {
    const { auth } = montar([]);
    const u = new URL(auth.iniciar(REDIRECT));
    const p = u.searchParams;
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe(REDIRECT);
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe(ESCOPOS.join(' '));
    expect(ESCOPOS).toEqual(['https://www.googleapis.com/auth/drive.readonly', 'openid', 'email']);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
  });

  it('o code_verifier enviado na troca bate com o code_challenge', async () => {
    const { auth, chamadas } = montar([() => json({ access_token: 'a', expires_in: 3600, refresh_token: 'r' })]);
    const u = auth.iniciar(REDIRECT);
    await auth.concluir({ code: 'c', state: stateDe(u) });
    const verifier = chamadas[0].body.get('code_verifier')!;
    const desafio = createHash('sha256').update(verifier).digest('base64url');
    expect(desafio).toBe(new URL(u).searchParams.get('code_challenge'));
  });

  it('concluir recusa state desconhecido', async () => {
    const { auth, chamadas } = montar([]);
    expect(await auth.concluir({ code: 'c', state: 'nope' })).toEqual({ ok: false, motivo: 'state-invalido' });
    expect(await auth.concluir({ code: 'c' })).toEqual({ ok: false, motivo: 'state-invalido' });
    expect(chamadas).toHaveLength(0);
  });

  it('concluir recusa state reusado', async () => {
    const { auth } = montar([() => json({ access_token: 'a', expires_in: 3600, refresh_token: 'r' })]);
    const s = stateDe(auth.iniciar(REDIRECT));
    expect((await auth.concluir({ code: 'c', state: s })).ok).toBe(true);
    expect(await auth.concluir({ code: 'c', state: s })).toEqual({ ok: false, motivo: 'state-invalido' });
  });

  it('concluir recusa state vencido', async () => {
    const { auth, avancar, chamadas } = montar([]);
    const s = stateDe(auth.iniciar(REDIRECT));
    avancar(10 * 60_000 + 1);
    expect(await auth.concluir({ code: 'c', state: s })).toEqual({ ok: false, motivo: 'state-invalido' });
    expect(chamadas).toHaveLength(0);
  });

  it('error=access_denied → negado', async () => {
    const { auth, chamadas } = montar([]);
    const s = stateDe(auth.iniciar(REDIRECT));
    expect(await auth.concluir({ error: 'access_denied', state: s })).toEqual({ ok: false, motivo: 'negado' });
    expect(chamadas).toHaveLength(0);
    // o state é consumido também na negativa
    expect(await auth.concluir({ code: 'c', state: s })).toEqual({ ok: false, motivo: 'state-invalido' });
  });

  it('concluir grava refresh token e email do id_token', async () => {
    const { auth, chamadas, setting } = montar([
      () => json({ access_token: 'a', expires_in: 3600, refresh_token: 'r1', id_token: idToken('eu@x.com') }),
    ]);
    const s = stateDe(auth.iniciar(REDIRECT));
    expect(await auth.concluir({ code: 'cod', state: s })).toEqual({ ok: true, email: 'eu@x.com' });
    expect(chamadas[0].url).toBe('https://oauth2.googleapis.com/token');
    const b = chamadas[0].body;
    expect(b.get('grant_type')).toBe('authorization_code');
    expect(b.get('code')).toBe('cod');
    expect(b.get('client_id')).toBe('cid');
    expect(b.get('client_secret')).toBe('csec');
    expect(b.get('redirect_uri')).toBe(REDIRECT);
    expect(setting('drive.refresh_token')).toBe('r1');
    expect(setting('drive.email')).toBe('eu@x.com');
    expect(auth.status()).toEqual({ conectado: true, email: 'eu@x.com' });
  });

  it('id_token ausente ou torto → email null', async () => {
    const { auth, setting } = montar([
      () => json({ access_token: 'a', expires_in: 3600, refresh_token: 'r1', id_token: 'lixo' }),
    ]);
    const s = stateDe(auth.iniciar(REDIRECT));
    expect(await auth.concluir({ code: 'c', state: s })).toEqual({ ok: true, email: null });
    expect(setting('drive.email')).toBeUndefined();
  });

  it('troca falha (não-2xx ou rede) → troca-falhou, sem lançar, e consome o state', async () => {
    const { auth } = montar([() => json({ error: 'invalid_grant' }, 400), () => Promise.reject(new TypeError('rede'))]);
    const s1 = stateDe(auth.iniciar(REDIRECT));
    expect(await auth.concluir({ code: 'c', state: s1 })).toEqual({ ok: false, motivo: 'troca-falhou' });
    expect(await auth.concluir({ code: 'c', state: s1 })).toEqual({ ok: false, motivo: 'state-invalido' });
    const s2 = stateDe(auth.iniciar(REDIRECT));
    expect(await auth.concluir({ code: 'c', state: s2 })).toEqual({ ok: false, motivo: 'troca-falhou' });
    expect(auth.status().conectado).toBe(false);
  });

  it('concluir sem clientId → sem-credenciais', async () => {
    const { auth } = montar([], { clientId: null, clientSecret: null, apiKey: null });
    expect(await auth.concluir({ code: 'c', state: 'x' })).toEqual({ ok: false, motivo: 'sem-credenciais' });
  });

  it('token sem refresh token devolve null', async () => {
    const { auth, chamadas } = montar([]);
    expect(await auth.token()).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it('token usa cache e renova perto de expirar', async () => {
    const { auth, db, chamadas, avancar } = montar([
      () => json({ access_token: 'a1', expires_in: 3600 }),
      () => json({ access_token: 'a2', expires_in: 3600 }),
      () => json({ access_token: 'a3', expires_in: 3600 }),
    ]);
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.refresh_token', 'rr')").run();
    expect(await auth.token()).toBe('a1');
    expect(chamadas[0].body.get('grant_type')).toBe('refresh_token');
    expect(chamadas[0].body.get('refresh_token')).toBe('rr');
    expect(chamadas[0].body.get('client_id')).toBe('cid');
    expect(chamadas[0].body.get('client_secret')).toBe('csec');
    avancar(3600_000 - 61_000);
    expect(await auth.token()).toBe('a1');
    expect(chamadas).toHaveLength(1);
    avancar(2_000); // falta menos de 60 s
    expect(await auth.token()).toBe('a2');
    expect(await auth.token({ renovar: true })).toBe('a3');
    expect(chamadas).toHaveLength(3);
  });

  it('invalid_grant na renovação desconecta e lança nao-autorizado', async () => {
    const { auth, db, setting } = montar([() => json({ error: 'invalid_grant' }, 400)]);
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.refresh_token', 'rr')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.email', 'e@x.com')").run();
    await expect(auth.token()).rejects.toMatchObject({ name: 'FalhaDrive', tipo: 'nao-autorizado' });
    expect(setting('drive.refresh_token')).toBeUndefined();
    expect(auth.status()).toEqual({ conectado: false, email: null });
    expect(await auth.token()).toBeNull();
  });

  it('falha de rede na renovação vira sem-conexao e mantém o refresh token', async () => {
    const { auth, db, setting } = montar([() => Promise.reject(new TypeError('rede'))]);
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.refresh_token', 'rr')").run();
    await expect(auth.token()).rejects.toBeInstanceOf(FalhaDrive);
    expect(setting('drive.refresh_token')).toBe('rr');
  });

  it('desconectar apaga settings mesmo se revoke falhar', async () => {
    const { auth, db, chamadas, setting } = montar([() => Promise.reject(new TypeError('rede'))]);
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.refresh_token', 'rr')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('drive.email', 'e@x.com')").run();
    await auth.desconectar();
    expect(chamadas[0].url).toBe('https://oauth2.googleapis.com/revoke?token=rr');
    expect(setting('drive.refresh_token')).toBeUndefined();
    expect(setting('drive.email')).toBeUndefined();
    expect(auth.status()).toEqual({ conectado: false, email: null });
  });

  it('sem clientId → iniciar lança FalhaDrive nao-autorizado', () => {
    const { auth } = montar([], { clientId: null, clientSecret: null, apiKey: null });
    expect(() => auth.iniciar(REDIRECT)).toThrow(FalhaDrive);
    try {
      auth.iniciar(REDIRECT);
    } catch (e) {
      expect((e as FalhaDrive).tipo).toBe('nao-autorizado');
    }
  });
});
