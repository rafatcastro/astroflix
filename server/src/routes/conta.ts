import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServicosConta } from '../nuvem/conta';
import type { Sincronizador } from '../nuvem/sincronizar';
import { FalhaNuvem } from '../nuvem/cliente';

// Conta do Astroflix: login (Google → Supabase), estado da sincronização e sair.
// O login segue o desenho do Drive: abre no navegador do sistema, o Google volta
// para /api/conta/callback (loopback), e a janela pergunta o resultado pelo state.

const redirectDe = (req: FastifyRequest) => `http://${req.headers.host}/api/conta/callback`;

function paginaCallback(ok: boolean): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Astroflix</title></head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#eee;padding:2rem">
<p>${ok ? 'Pronto, você entrou. Pode fechar esta aba e voltar ao Astroflix.' : 'Não foi possível entrar. Volte ao Astroflix e tente de novo.'}</p>
</body></html>`;
}

export async function contaRoutes(
  app: FastifyInstance,
  opts: { conta: ServicosConta; sinc: Sincronizador | null },
): Promise<void> {
  const { conta, sinc } = opts;

  app.get('/api/conta', async () => {
    const e = conta.estado();
    return {
      configurada: e.configurada,
      entrou: e.entrou,
      email: e.email,
      nuvem: e.entrou && sinc ? sinc.estado() : null,
    };
  });

  app.post('/api/conta/login', async (req, reply) => {
    if (!conta.configurada) return reply.code(503).send({ error: 'sem-nuvem' });
    try {
      return { url: conta.iniciarLogin(redirectDe(req)) };
    } catch (e) {
      if (e instanceof FalhaNuvem) return reply.code(503).send({ error: 'sem-credenciais' });
      throw e;
    }
  });

  // GET e sem Origin: a defesa é o state de uso único + PKCE (ver conta.ts). Nada
  // da query é refletido na página.
  app.get('/api/conta/callback', async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const r = await conta.concluirLogin({ code: str(q.code), state: str(q.state), error: str(q.error) });
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'")
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send(paginaCallback(r.ok));
  });

  app.get('/api/conta/login/resultado', async (req, reply) => {
    const state = (req.query as Record<string, unknown> | undefined)?.state;
    if (typeof state !== 'string' || !state) return reply.code(400).send({ error: 'sem-state' });
    const r = conta.resultadoLogin(state);
    return r ? { pronto: true, ...r } : { pronto: false };
  });

  app.post('/api/conta/sincronizar', async (_req, reply) => {
    if (!sinc || !conta.estado().entrou) return reply.code(401).send({ error: 'precisa-entrar' });
    return sinc.sincronizar();
  });

  app.post('/api/conta/sair', async (_req, reply) => {
    // Sobe o que estava na fila antes de sair: sair não pode perder o que a pessoa fez.
    if (sinc && conta.estado().entrou) await sinc.sincronizar();
    await conta.sair();
    sinc?.aoSair();
    return reply.code(204).send();
  });
}
