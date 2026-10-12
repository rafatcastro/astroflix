import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import type { ServicosDrive } from '../drive/servicos';
import { FalhaDrive } from '../drive/tipos';
import { parseLinkDrive } from '../drive/link';
import { statusDaFalha } from '../drive/status';
import { credenciaisGoogle, salvarCredenciais } from '../drive/credenciais';
import { createCourseFromDrive } from '../scan/scan-drive';

const CAMPOS = ['clientId', 'clientSecret', 'apiKey'] as const;

// O redirect usa o host da requisição (porta incluída): o app anda para a
// próxima porta quando a 7777 está ocupada, então um valor fixo quebraria o login.
const redirectDe = (req: FastifyRequest) => `http://${req.headers.host}/api/drive/auth/callback`;

// Página que o popup do Google abre ao voltar. Nada vindo da query entra no
// HTML: o resultado é só { ok, motivo } de um enum fixo, serializado e com "<"
// escapado, e o script só roda com o nonce desta resposta (CSP).
function paginaCallback(ok: boolean, motivo: string | null, nonce: string): string {
  const msg = JSON.stringify({ tipo: 'learnflix-drive', ok, motivo }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Learnflix</title></head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#eee;padding:2rem">
<p>${ok ? 'Conta conectada.' : 'Não foi possível conectar a conta.'} Pode fechar esta janela.</p>
<script nonce="${nonce}">
window.opener?.postMessage(${msg}, location.origin);
// Link de fallback (popup bloqueado) abre numa aba sem opener, e o postMessage não chega.
// O BroadcastChannel alcança qualquer aba da mesma origem.
try { const c = new BroadcastChannel('learnflix-drive'); c.postMessage(${msg}); c.close(); } catch {}
window.close();
</script></body></html>`;
}

export async function driveRoutes(app: FastifyInstance, opts: { db: Db; drive: ServicosDrive }): Promise<void> {
  const { db, drive } = opts;

  app.post('/api/drive/courses', async (req, reply) => {
    const texto = (req.body as { link?: unknown } | undefined)?.link;
    const link = typeof texto === 'string' ? parseLinkDrive(texto) : null;
    if (!link) return reply.code(400).send({ error: 'link-invalido' });

    try {
      const { id, existente } = await createCourseFromDrive(
        db,
        drive.ingestao(link.resourceKey ? `${link.folderId}/${link.resourceKey}` : null),
        link,
        (texto as string).trim(),
      );
      return reply.code(existente ? 200 : 201).send({ id, existente });
    } catch (e) {
      if (!(e instanceof FalhaDrive)) throw e;
      // Sem conta conectada, "sem acesso" quase sempre quer dizer "pasta privada":
      // o caminho é pedir o login. Com conta, a pasta é mesmo inacessível a ela.
      if ((e.tipo === 'sem-acesso' || e.tipo === 'nao-autorizado') && !drive.auth.status().conectado) {
        try {
          return reply.code(401).send({ precisaAutorizar: true, url: drive.auth.iniciar(redirectDe(req)) });
        } catch (e2) {
          if (e2 instanceof FalhaDrive) return reply.code(503).send({ error: 'sem-credenciais' });
          throw e2;
        }
      }
      return reply.code(statusDaFalha(e.tipo)).send({ error: e.tipo });
    }
  });

  // Reautorizar com a pasta já adicionada (token revogado): não há curso novo
  // para disparar o 401, então o player pede a url diretamente.
  app.post('/api/drive/auth/iniciar', async (req, reply) => {
    try {
      return { url: drive.auth.iniciar(redirectDe(req)) };
    } catch (e) {
      if (e instanceof FalhaDrive) return reply.code(503).send({ error: 'sem-credenciais' });
      throw e;
    }
  });

  // GET e sem Origin: a defesa aqui é o state de uso único + PKCE dentro do auth,
  // não a guarda de origem. Por isso nenhum valor da query é refletido.
  app.get('/api/drive/auth/callback', async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const r = await drive.auth.concluir({ code: str(q.code), state: str(q.state), error: str(q.error) });
    const nonce = randomBytes(16).toString('base64url');
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .header(
        'content-security-policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'`,
      )
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send(paginaCallback(r.ok, r.ok ? null : r.motivo, nonce));
  });

  app.get('/api/drive/status', async () => {
    const c = credenciaisGoogle(db);
    return {
      ...drive.auth.status(),
      credenciais: { clientId: !!c.clientId, clientSecret: !!c.clientSecret, apiKey: !!c.apiKey },
    };
  });

  app.delete('/api/drive/auth', async (_req, reply) => {
    await drive.auth.desconectar();
    return reply.code(204).send();
  });

  app.put('/api/drive/credenciais', async (req, reply) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return reply.code(400).send({ error: 'corpo-invalido' });
    const parcial: Partial<Record<(typeof CAMPOS)[number], string>> = {};
    for (const c of CAMPOS) {
      const v = (b as Record<string, unknown>)[c];
      if (typeof v === 'string') parcial[c] = v.trim();
    }
    const antes = credenciaisGoogle(db);
    salvarCredenciais(db, parcial);
    const depois = credenciaisGoogle(db);
    // O refresh token pertence ao client OAuth que o emitiu: com outro client ele
    // só falharia com invalid_grant, e o e-mail mostrado seria de uma conta velha.
    if (antes.clientId !== depois.clientId || antes.clientSecret !== depois.clientSecret) {
      await drive.auth.desconectar({ revogar: false });
    }
    return reply.code(204).send();
  });
}
