import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db';
import type { CredenciaisGoogle, Fetch } from '../drive/tipos';
import { ESCOPOS } from '../drive/auth';
import { FalhaNuvem, type ClienteSupabase, type SessaoSupabase } from './cliente';

// A conta do Astroflix: login com Google (o mesmo cliente OAuth e o mesmo PKCE
// pelo navegador do sistema que o Drive usa) trocado por uma sessão do Supabase.
// O Google só entrega o id_token; quem vira dono dos dados é o usuário do Supabase.

const URL_AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const VALIDADE_STATE_MS = 10 * 60_000;
const FOLGA_MS = 60_000;
const K_SESSAO = 'conta.sessao';

export type MotivoLogin = 'state-invalido' | 'negado' | 'troca-falhou' | 'sem-credenciais' | 'nuvem-recusou' | 'sem-conexao';

export interface ServicosConta {
  /** Sem projeto Supabase no build, o app roda sem conta. */
  readonly configurada: boolean;
  estado(): { configurada: boolean; entrou: boolean; email: string | null; userId: string | null };
  iniciarLogin(redirectUri: string): string;
  concluirLogin(p: { code?: string; state?: string; error?: string }): Promise<{ ok: true } | { ok: false; motivo: MotivoLogin }>;
  resultadoLogin(state: string): { ok: true } | { ok: false; motivo: MotivoLogin } | null;
  /** Access token válido (renova se preciso). FalhaNuvem('sessao-expirada') se a sessão acabou. */
  token(): Promise<string>;
  sair(): Promise<void>;
}

export function criarServicosConta(deps: {
  db: Db;
  fetch: Fetch;
  supabase: ClienteSupabase | null;
  credenciaisGoogle: () => CredenciaisGoogle;
  /** Depois de entrar: a sincronização prepara o cache (troca de conta, primeira subida). */
  aoEntrar?: (s: SessaoSupabase) => void;
  /** A pessoa deixou marcado o acesso ao Drive na tela do Google: vira a conexão do Drive. */
  aoConcederDrive?: (t: { refreshToken: string; email: string | null; accessToken?: string; expiresIn?: number }) => void;
  agora?: () => number;
}): ServicosConta {
  const { db, supabase } = deps;
  const agora = deps.agora ?? Date.now;
  const pendentes = new Map<string, { verifier: string; redirectUri: string; expira: number }>();
  const concluidos = new Map<string, { r: { ok: true } | { ok: false; motivo: MotivoLogin }; expira: number }>();
  let renovando: Promise<SessaoSupabase> | null = null;

  const ler = (): SessaoSupabase | null => {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(K_SESSAO) as { value: string } | undefined;
    if (!r) return null;
    try {
      return JSON.parse(r.value) as SessaoSupabase;
    } catch {
      return null;
    }
  };
  const gravar = (s: SessaoSupabase) =>
    db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(K_SESSAO, JSON.stringify(s));
  const apagar = () => db.prepare('DELETE FROM settings WHERE key=?').run(K_SESSAO);

  interface RespostaCode {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }

  async function trocarCode(code: string, pend: { verifier: string; redirectUri: string }): Promise<RespostaCode | null> {
    const c = deps.credenciaisGoogle();
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: pend.verifier,
      redirect_uri: pend.redirectUri,
      client_id: c.clientId ?? '',
    });
    if (c.clientSecret) form.set('client_secret', c.clientSecret);
    const res = await deps.fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as RespostaCode;
    return res.ok && j.id_token ? j : null;
  }

  async function concluir(p: { code?: string; state?: string; error?: string }): Promise<{ ok: true } | { ok: false; motivo: MotivoLogin }> {
    if (!supabase) return { ok: false, motivo: 'sem-credenciais' };
    // Uso único: o state sai do mapa antes de qualquer outra checagem.
    const pend = p.state ? pendentes.get(p.state) : undefined;
    if (p.state) pendentes.delete(p.state);
    if (!pend || pend.expira < agora()) return { ok: false, motivo: 'state-invalido' };
    if (p.error) return { ok: false, motivo: 'negado' };
    if (!p.code) return { ok: false, motivo: 'troca-falhou' };
    let tokens: RespostaCode | null;
    try {
      tokens = await trocarCode(p.code, pend);
    } catch {
      return { ok: false, motivo: 'sem-conexao' };
    }
    if (!tokens?.id_token) return { ok: false, motivo: 'troca-falhou' };
    let s: SessaoSupabase;
    try {
      s = await supabase.entrarComIdToken(tokens.id_token);
    } catch (e) {
      return { ok: false, motivo: e instanceof FalhaNuvem && e.tipo === 'sem-conexao' ? 'sem-conexao' : 'nuvem-recusou' };
    }
    gravar(s);
    // A tela do Google deixa desmarcar o Drive: só conecta se ele veio mesmo. Sem
    // ele, a interface mostra "Conectar o Google Drive" no lugar de importar.
    const drive = ESCOPOS[0];
    if (tokens.refresh_token && (tokens.scope ?? '').split(' ').includes(drive)) {
      deps.aoConcederDrive?.({ refreshToken: tokens.refresh_token, email: s.email ?? null, accessToken: tokens.access_token, expiresIn: tokens.expires_in });
    }
    deps.aoEntrar?.(s);
    return { ok: true };
  }

  return {
    configurada: !!supabase,
    estado() {
      const s = ler();
      return { configurada: !!supabase, entrou: !!s, email: s?.email ?? null, userId: s?.userId ?? null };
    },
    iniciarLogin(redirectUri) {
      const c = deps.credenciaisGoogle();
      if (!c.clientId) throw new FalhaNuvem('recusado', undefined, 'sem-credenciais');
      for (const [k, v] of pendentes) if (v.expira < agora()) pendentes.delete(k);
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      pendentes.set(state, { verifier, redirectUri, expira: agora() + VALIDADE_STATE_MS });
      const q = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        // O Drive vem junto, logo na entrada, para a pessoa não ter de autorizar de novo
        // na primeira importação. Offline: o Drive precisa do refresh token.
        scope: `openid email profile ${ESCOPOS[0]}`,
        access_type: 'offline',
        include_granted_scopes: 'true',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
        // Escolher a conta sempre: no mesmo navegador pode haver várias, e entrar
        // na errada mostraria a biblioteca de outra pessoa.
        // consent: sem ele, quem já autorizou antes não recebe outro refresh token.
        prompt: 'select_account consent',
      });
      return `${URL_AUTORIZAR}?${q.toString()}`;
    },
    async concluirLogin(p) {
      const r = await concluir(p);
      if (p.state) {
        for (const [k, v] of concluidos) if (v.expira < agora()) concluidos.delete(k);
        concluidos.set(p.state, { r, expira: agora() + VALIDADE_STATE_MS });
      }
      return r;
    },
    resultadoLogin(state) {
      const f = concluidos.get(state);
      return f && f.expira >= agora() ? f.r : null;
    },
    async token() {
      const s = ler();
      if (!s || !supabase) throw new FalhaNuvem('sessao-expirada');
      if (s.expiraEm - FOLGA_MS > agora()) return s.accessToken;
      renovando ??= supabase
        .renovar(s.refreshToken)
        .then((nova) => {
          gravar(nova);
          return nova;
        })
        .finally(() => {
          renovando = null;
        });
      try {
        return (await renovando).accessToken;
      } catch (e) {
        // Sessão recusada de vez: sem apagar, o app ficaria tentando para sempre.
        if (e instanceof FalhaNuvem && e.tipo === 'sessao-expirada') apagar();
        throw e;
      }
    },
    async sair() {
      const s = ler();
      apagar();
      // Melhor esforço: sem rede, sair desta máquina ainda tem de funcionar.
      if (s && supabase) await supabase.sair(s.accessToken).catch(() => {});
    },
  };
}
