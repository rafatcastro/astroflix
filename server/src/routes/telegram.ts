import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { parseLinkTelegram } from '../telegram/link';
import type { ServicosTelegram } from '../telegram/servicos';
import type { ClienteTelegram, GrupoTelegram } from '../telegram/cliente';
import { respostaDeFalhaTelegram } from '../telegram/stream';
import { salvarCredenciaisTelegram } from '../telegram/credenciais';
import { createCourseFromTelegram } from '../scan/scan-telegram';

export async function telegramRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: AppConfig; telegram: ServicosTelegram },
): Promise<void> {
  const { db, config, telegram } = opts;

  const criar = async (cliente: ClienteTelegram, grupo: GrupoTelegram, link: string) =>
    createCourseFromTelegram(db, { cliente, config }, grupo, link);

  // Sem conta: 401 com precisaConectar, e a interface mostra o QR. Convite de um
  // grupo em que a pessoa ainda não está: 409, e a interface pergunta antes de
  // entrar — entrar num grupo é uma ação na conta dela, nunca automática.
  app.post('/api/telegram/courses', async (req, reply) => {
    const texto = (req.body as { link?: unknown } | undefined)?.link;
    const link = typeof texto === 'string' ? parseLinkTelegram(texto) : null;
    if (!link) return reply.code(400).send({ error: 'link-invalido' });
    try {
      const cliente = await telegram.cliente();
      let grupo: GrupoTelegram;
      if (link.tipo === 'convite') {
        const c = await cliente.verConvite(link.hash);
        if (c.tipo === 'convite') return reply.code(409).send({ convite: true, titulo: c.titulo });
        grupo = c.grupo;
      } else {
        grupo = await cliente.resolver(link);
      }
      const r = await criar(cliente, grupo, (texto as string).trim());
      return reply.code(r.existente ? 200 : 201).send(r);
    } catch (e) {
      const r = respostaDeFalhaTelegram(e);
      if (r.corpo.error === 'nao-autorizado') return reply.code(401).send({ precisaConectar: true });
      return reply.code(r.status).send(r.corpo);
    }
  });

  app.post('/api/telegram/convite', async (req, reply) => {
    const texto = (req.body as { link?: unknown } | undefined)?.link;
    const link = typeof texto === 'string' ? parseLinkTelegram(texto) : null;
    if (link?.tipo !== 'convite') return reply.code(400).send({ error: 'link-invalido' });
    try {
      const cliente = await telegram.cliente();
      const grupo = await cliente.entrarPorConvite(link.hash);
      const r = await criar(cliente, grupo, (texto as string).trim());
      return reply.code(r.existente ? 200 : 201).send(r);
    } catch (e) {
      const r = respostaDeFalhaTelegram(e);
      return reply.code(r.status).send(r.corpo);
    }
  });

  app.get('/api/telegram/status', async () => telegram.status());

  app.post('/api/telegram/login', async (_req, reply) => {
    try {
      return await telegram.login.iniciar();
    } catch (e) {
      const r = respostaDeFalhaTelegram(e);
      return reply.code(r.status).send(r.corpo);
    }
  });
  app.get('/api/telegram/login', async () => telegram.login.estado());
  app.post('/api/telegram/login/senha', async (req, reply) => {
    const senha = (req.body as { senha?: unknown } | undefined)?.senha;
    if (typeof senha !== 'string' || !senha) return reply.code(400).send({ error: 'sem-senha' });
    return telegram.login.senha(senha);
  });
  app.delete('/api/telegram/login', async (_req, reply) => {
    telegram.login.cancelar();
    return reply.code(204).send();
  });

  app.delete('/api/telegram/auth', async (_req, reply) => {
    await telegram.desconectar();
    return reply.code(204).send();
  });

  // Trocar o app do Telegram invalida a sessão: ela foi criada com o api_id
  // antigo. Desconecta antes de gravar, enquanto a credencial velha ainda serve
  // para encerrar a sessão do lado do Telegram.
  app.put('/api/telegram/credenciais', async (req, reply) => {
    const b = (req.body ?? {}) as { apiId?: unknown; apiHash?: unknown };
    const parcial: { apiId?: string | number | null; apiHash?: string | null } = {};
    if ('apiId' in b) {
      if (b.apiId !== null && typeof b.apiId !== 'string' && typeof b.apiId !== 'number') return reply.code(400).send({ error: 'invalido' });
      parcial.apiId = b.apiId as string | number | null;
    }
    if ('apiHash' in b) {
      if (b.apiHash !== null && typeof b.apiHash !== 'string') return reply.code(400).send({ error: 'invalido' });
      parcial.apiHash = (b.apiHash as string | null)?.trim() || null;
    }
    if (telegram.status().conectado) await telegram.aoTrocarCredenciais();
    salvarCredenciaisTelegram(db, parcial);
    return telegram.status();
  });
}
