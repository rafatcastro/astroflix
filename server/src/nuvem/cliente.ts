import { SUPABASE_PADRAO } from '../bundled';
import type { Fetch } from '../drive/tipos';

// Conversa com o projeto Supabase da conta: Auth (sessão a partir do id_token do
// Google) e PostgREST (as tabelas de supabase/schema.sql). REST cru com `fetch`
// injetável, como o Drive: os testes trocam o Supabase por um falso em memória,
// e o app não carrega o supabase-js (que traria realtime e storage à toa).

export type TipoFalhaNuvem = 'sem-conexao' | 'sessao-expirada' | 'recusado';

export class FalhaNuvem extends Error {
  constructor(
    readonly tipo: TipoFalhaNuvem,
    readonly status?: number,
    mensagem?: string,
  ) {
    super(mensagem ?? tipo);
    this.name = 'FalhaNuvem';
  }
}

export interface ConfigSupabase {
  url: string;
  publishableKey: string;
}

/** Projeto do build (ou das envs). null = app sem conta (fork ou dev sem projeto). */
export function configSupabase(env: NodeJS.ProcessEnv = process.env, padrao = SUPABASE_PADRAO): ConfigSupabase | null {
  const url = env.SUPABASE_URL || padrao.url;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || padrao.publishableKey;
  return url && publishableKey ? { url: url.replace(/\/+$/, ''), publishableKey } : null;
}

export interface SessaoSupabase {
  accessToken: string;
  refreshToken: string;
  /** ms desde a época. */
  expiraEm: number;
  userId: string;
  email: string | null;
}

export interface ClienteSupabase {
  entrarComIdToken(idToken: string): Promise<SessaoSupabase>;
  renovar(refreshToken: string): Promise<SessaoSupabase>;
  sair(accessToken: string): Promise<void>;
  upsert(token: string, tabela: string, linhas: object[], conflito: string): Promise<void>;
  /** Linhas carimbadas pelo banco depois de `desde` (ISO), na ordem, até `limite`. */
  mudancas(token: string, tabela: string, desde: string | null, limite: number): Promise<Array<Record<string, unknown>>>;
}

const TIMEOUT_MS = 20_000;

export function criarClienteSupabase(cfg: ConfigSupabase, fetchFn: Fetch = fetch, agora: () => number = Date.now): ClienteSupabase {
  async function chamar(caminho: string, init: RequestInit & { token?: string }): Promise<Response> {
    const headers: Record<string, string> = { apikey: cfg.publishableKey, ...(init.headers as Record<string, string>) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let res: Response;
    try {
      res = await fetchFn(`${cfg.url}${caminho}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FalhaNuvem('sem-conexao');
    }
    if (res.status === 401) throw new FalhaNuvem('sessao-expirada', 401);
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new FalhaNuvem(res.status >= 500 ? 'sem-conexao' : 'recusado', res.status, corpo.slice(0, 300));
    }
    return res;
  }

  async function sessao(caminho: string, corpo: object): Promise<SessaoSupabase> {
    const res = await chamar(caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const j = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user?: { id?: string; email?: string };
    };
    if (!j.access_token || !j.refresh_token || !j.user?.id) throw new FalhaNuvem('recusado', res.status, 'sessão sem token');
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiraEm: agora() + (j.expires_in ?? 3600) * 1000,
      userId: j.user.id,
      email: j.user.email ?? null,
    };
  }

  return {
    entrarComIdToken: (idToken) => sessao('/auth/v1/token?grant_type=id_token', { provider: 'google', id_token: idToken }),
    async renovar(refreshToken) {
      try {
        return await sessao('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
      } catch (e) {
        // Refresh token recusado (revogado, conta apagada): a sessão acabou de vez.
        if (e instanceof FalhaNuvem && e.tipo === 'recusado') throw new FalhaNuvem('sessao-expirada', e.status);
        throw e;
      }
    },
    async sair(accessToken) {
      await chamar('/auth/v1/logout', { method: 'POST', token: accessToken });
    },
    async upsert(token, tabela, linhas, conflito) {
      if (!linhas.length) return;
      await chamar(`/rest/v1/${tabela}?on_conflict=${conflito}`, {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(linhas),
      });
    },
    async mudancas(token, tabela, desde, limite) {
      const filtro = desde ? `&atualizado_em=gt.${encodeURIComponent(desde)}` : '';
      const res = await chamar(`/rest/v1/${tabela}?select=*${filtro}&order=atualizado_em.asc&limit=${limite}`, { method: 'GET', token });
      return (await res.json()) as Array<Record<string, unknown>>;
    },
  };
}
