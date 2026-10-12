import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index';
import { FalhaDrive, type CredenciaisGoogle, type Fetch } from './tipos';

export const ESCOPOS: string[] = ['https://www.googleapis.com/auth/drive.readonly', 'openid', 'email'];

const URL_AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const URL_REVOGAR = 'https://oauth2.googleapis.com/revoke';
const VALIDADE_STATE_MS = 10 * 60_000;
// Renovar com folga: um token que expira no meio de uma listagem derrubaria a chamada.
const FOLGA_TOKEN_MS = 60_000;
const K_REFRESH = 'drive.refresh_token';
const K_EMAIL = 'drive.email';

export type MotivoFalha = 'state-invalido' | 'negado' | 'troca-falhou' | 'sem-credenciais';

export interface AuthDrive {
  iniciar(redirectUri: string): string;
  concluir(p: { code?: string; state?: string; error?: string }): Promise<
    { ok: true; email: string | null } | { ok: false; motivo: MotivoFalha }
  >;
  token(opts?: { renovar?: boolean }): Promise<string | null>;
  status(): { conectado: boolean; email: string | null };
  desconectar(): Promise<void>;
}

interface Pendente {
  verifier: string;
  redirectUri: string;
  expira: number;
}

interface RespostaToken {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
}

function emailDoIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    // Sem verificar assinatura: o token veio direto do Google por TLS na troca do code.
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload?.email === 'string' && payload.email ? payload.email : null;
  } catch {
    return null;
  }
}

export function criarAuthDrive(deps: {
  db: Db;
  fetch: Fetch;
  credenciais: () => CredenciaisGoogle;
  agora?: () => number;
}): AuthDrive {
  const { db, credenciais } = deps;
  const agora = deps.agora ?? Date.now;
  const pendentes = new Map<string, Pendente>();
  let cache: { token: string; expiraEm: number } | null = null;
  // Evita duas renovações simultâneas com o mesmo refresh token.
  let renovando: Promise<string> | null = null;

  const ler = (k: string): string | null =>
    ((db.prepare('SELECT value FROM settings WHERE key=?').get(k) as { value: string } | undefined)?.value ?? null);
  const gravar = (k: string, v: string) =>
    db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(k, v);
  const apagar = (k: string) => db.prepare('DELETE FROM settings WHERE key=?').run(k);

  function podarVencidos() {
    const t = agora();
    for (const [s, p] of pendentes) if (p.expira < t) pendentes.delete(s);
  }

  async function postarToken(corpo: Record<string, string>, c: CredenciaisGoogle) {
    const form = new URLSearchParams({ ...corpo, client_id: c.clientId ?? '' });
    if (c.clientSecret) form.set('client_secret', c.clientSecret);
    const res = await deps.fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as RespostaToken;
    return { res, json };
  }

  function guardarAcesso(json: RespostaToken): string | null {
    if (!json.access_token) return null;
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    cache = { token: json.access_token, expiraEm: agora() + ttl * 1000 };
    return json.access_token;
  }

  function limparConexao() {
    cache = null;
    apagar(K_REFRESH);
    apagar(K_EMAIL);
  }

  async function renovarAcesso(refresh: string): Promise<string> {
    const c = credenciais();
    let r;
    try {
      r = await postarToken({ grant_type: 'refresh_token', refresh_token: refresh }, c);
    } catch {
      throw new FalhaDrive('sem-conexao');
    }
    if (!r.res.ok) {
      if (r.json.error === 'invalid_grant') {
        // Revogado ou expirado: manter o refresh token só faria repetir o erro.
        limparConexao();
        throw new FalhaDrive('nao-autorizado', r.res.status);
      }
      throw new FalhaDrive('google', r.res.status);
    }
    const t = guardarAcesso(r.json);
    if (!t) throw new FalhaDrive('google', r.res.status);
    return t;
  }

  return {
    iniciar(redirectUri) {
      const c = credenciais();
      if (!c.clientId) throw new FalhaDrive('nao-autorizado');
      podarVencidos();
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      const desafio = createHash('sha256').update(verifier).digest('base64url');
      pendentes.set(state, { verifier, redirectUri, expira: agora() + VALIDADE_STATE_MS });
      const p = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: ESCOPOS.join(' '),
        code_challenge: desafio,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      });
      return `${URL_AUTORIZAR}?${p.toString()}`;
    },

    async concluir({ code, state, error }) {
      const c = credenciais();
      if (!c.clientId) return { ok: false, motivo: 'sem-credenciais' };
      // Uso único: o state sai do mapa antes de qualquer outra checagem, até na negativa e na falha.
      const pend = state ? pendentes.get(state) : undefined;
      if (state) pendentes.delete(state);
      if (!pend || pend.expira < agora()) return { ok: false, motivo: 'state-invalido' };
      if (error) return { ok: false, motivo: 'negado' };
      if (!code) return { ok: false, motivo: 'troca-falhou' };
      try {
        const { res, json } = await postarToken(
          {
            grant_type: 'authorization_code',
            code,
            code_verifier: pend.verifier,
            redirect_uri: pend.redirectUri,
          },
          c,
        );
        if (!res.ok || !json.refresh_token) return { ok: false, motivo: 'troca-falhou' };
        const email = emailDoIdToken(json.id_token);
        gravar(K_REFRESH, json.refresh_token);
        if (email) gravar(K_EMAIL, email);
        else apagar(K_EMAIL);
        guardarAcesso(json);
        return { ok: true, email };
      } catch {
        return { ok: false, motivo: 'troca-falhou' };
      }
    },

    async token(opts) {
      const refresh = ler(K_REFRESH);
      if (!refresh) return null;
      if (!opts?.renovar && cache && cache.expiraEm - FOLGA_TOKEN_MS > agora()) return cache.token;
      renovando ??= renovarAcesso(refresh).finally(() => {
        renovando = null;
      });
      return renovando;
    },

    status() {
      return { conectado: ler(K_REFRESH) !== null, email: ler(K_EMAIL) };
    },

    async desconectar() {
      const refresh = ler(K_REFRESH);
      limparConexao();
      if (!refresh) return;
      try {
        // Melhor esforço: sem rede a pessoa ainda precisa conseguir desconectar localmente.
        await deps.fetch(`${URL_REVOGAR}?token=${encodeURIComponent(refresh)}`, { method: 'POST' });
      } catch {
        /* ignorado de propósito */
      }
    },
  };
}
