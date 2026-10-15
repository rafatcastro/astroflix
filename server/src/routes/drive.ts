import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import type { ServicosDrive } from '../drive/servicos';
import { FalhaDrive } from '../drive/tipos';
import { parseLinkDrive } from '../drive/link';
import { statusDaFalha } from '../drive/status';
import { credenciaisGoogle, salvarCredenciais } from '../drive/credenciais';
import { createCourseFromDrive } from '../scan/scan-drive';

const CAMPOS = ['clientId', 'clientSecret', 'apiKey'] as const;
const PASTA = 'application/vnd.google-apps.folder';
const PDF = 'application/pdf';
const ATALHO = 'application/vnd.google-apps.shortcut';

// O redirect usa o host da requisição (porta incluída): o app anda para a
// próxima porta quando a 7777 está ocupada, então um valor fixo quebraria o login.
const redirectDe = (req: FastifyRequest) => `http://${req.headers.host}/api/drive/auth/callback`;

// Página que o Google abre ao voltar, no navegador do sistema (fora do app). Ela
// só informa: a janela do app descobre o resultado perguntando por
// /api/drive/auth/resultado. Nada vindo da query entra no HTML.
function paginaCallback(ok: boolean): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Learnflix</title></head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#eee;padding:2rem">
<p>${ok ? 'Conta conectada. Pode fechar esta aba e voltar ao Learnflix.' : 'Não foi possível conectar a conta. Volte ao Learnflix e tente de novo.'}</p>
</body></html>`;
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

  // O seletor de PDFs do Drive: pastas e PDFs de "Meu Drive", de "Compartilhados
  // comigo" ou de uma pasta. Precisa da conta Google conectada (sem ela não há
  // "Meu Drive"); sem conta, devolve a url do login, como o link de um curso.
  app.get('/api/drive/navegar', async (req, reply) => {
    const pasta = (req.query as { pasta?: string }).pasta || 'root';
    if (pasta !== 'root' && pasta !== 'compartilhados' && !/^[\w-]{5,}$/.test(pasta)) return reply.code(400).send({ error: 'pasta-invalida' });
    if (!drive.auth.status().conectado) {
      try {
        return reply.code(401).send({ precisaAutorizar: true, url: drive.auth.iniciar(redirectDe(req)) });
      } catch (e) {
        if (e instanceof FalhaDrive) return reply.code(503).send({ error: 'sem-credenciais' });
        throw e;
      }
    }
    const tipos = `(mimeType='${PASTA}' or mimeType='${PDF}' or mimeType='${ATALHO}')`;
    const q =
      pasta === 'compartilhados' ? `sharedWithMe and trashed=false and ${tipos}` : `'${pasta}' in parents and trashed=false and ${tipos}`;
    try {
      const itens = (await drive.cliente().listar(q))
        .map((a) => {
          const alvo = a.mimeType === ATALHO && a.shortcutDetails ? { id: a.shortcutDetails.targetId, mime: a.shortcutDetails.targetMimeType } : { id: a.id, mime: a.mimeType };
          const tipo = alvo.mime === PASTA ? ('pasta' as const) : alvo.mime === PDF ? ('pdf' as const) : null;
          return tipo && { id: alvo.id, nome: a.name, tipo, resourceKey: alvo.id === a.id ? (a.resourceKey ?? null) : null, tamanho: Number(a.size ?? 0) };
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }) : a.tipo === 'pasta' ? -1 : 1));
      return { itens };
    } catch (e) {
      if (!(e instanceof FalhaDrive)) throw e;
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
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
      )
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send(paginaCallback(r.ok));
  });

  app.get('/api/drive/auth/resultado', async (req, reply) => {
    const state = (req.query as Record<string, unknown> | undefined)?.state;
    if (typeof state !== 'string' || !state) return reply.code(400).send({ error: 'sem-state' });
    const r = drive.auth.resultado(state);
    return r ? { pronto: true, ...r } : { pronto: false };
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
