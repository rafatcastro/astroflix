import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import {
  cancelarDescoberta,
  comLoginDaDescoberta,
  criarCursoDeLinks,
  estadoDaDescoberta,
  iniciarDescoberta,
  logDoCurso,
  pastaDoLogDaDescoberta,
  pastaDosLogs,
  retentarImportacao,
} from '../links/importar';
import fs from 'node:fs';
import { temYtDlp } from '../links/ytdlp';
import { abrirNoSistema } from './armazenamento';

// Importar por link (links/importar.ts). A descoberta pode levar um minuto (abre
// link por link da página), então é um trabalho em segundo plano que a janela
// consulta, como o login do Telegram.
export async function linksRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }): Promise<void> {
  const { db, config } = opts;

  app.get('/api/links/status', async () => ({ ytdlp: temYtDlp() }));

  app.post('/api/links/descobrir', async (req, reply) => {
    const b = req.body as { link?: unknown; token?: unknown } | undefined;
    const link = b?.link;
    if (typeof link !== 'string' || !/^https?:\/\/\S+$/i.test(link.trim())) return reply.code(400).send({ error: 'link-invalido' });
    if (!temYtDlp()) return reply.code(424).send({ error: 'sem-ytdlp' });
    const token = typeof b?.token === 'string' && b.token.trim() ? b.token.trim() : null;
    return reply.code(202).send({ id: iniciarDescoberta(config, link.trim(), token) });
  });

  app.get('/api/links/descobrir/:id', async (req, reply) => {
    const e = estadoDaDescoberta((req.params as { id: string }).id);
    return e ?? reply.code(404).send({ error: 'not_found' });
  });

  app.delete('/api/links/descobrir/:id', async (req, reply) => {
    cancelarDescoberta((req.params as { id: string }).id);
    return reply.code(204).send();
  });

  app.post('/api/links/importar', async (req, reply) => {
    const b = req.body as { titulo?: unknown; link?: unknown; categoriaId?: unknown; itens?: unknown; token?: unknown; descoberta?: unknown } | undefined;
    const itens = Array.isArray(b?.itens)
      ? (b.itens as Array<{ url?: unknown; titulo?: unknown; pagina?: unknown }>)
          .filter((i) => typeof i?.url === 'string' && /^https?:\/\//i.test(i.url))
          .map((i) => ({
            url: i.url as string,
            titulo: typeof i.titulo === 'string' ? i.titulo : (i.url as string),
            pagina: typeof i.pagina === 'string' && /^https?:\/\//i.test(i.pagina) ? i.pagina : null,
          }))
      : [];
    if (!itens.length || typeof b?.link !== 'string') return reply.code(400).send({ error: 'sem-videos' });
    const categoriaId = typeof b.categoriaId === 'string' && b.categoriaId ? b.categoriaId : null;
    if (categoriaId && !db.prepare('SELECT 1 FROM collections WHERE id=?').get(categoriaId)) return reply.code(400).send({ error: 'categoria' });
    const id = criarCursoDeLinks(db, config, {
      titulo: typeof b.titulo === 'string' ? b.titulo : '',
      link: b.link,
      categoriaId,
      token: typeof b.token === 'string' && b.token.trim() ? b.token.trim() : null,
      comLogin: typeof b.descoberta === 'string' ? comLoginDaDescoberta(b.descoberta) : new Set(),
      itens,
    });
    return reply.code(201).send({ id });
  });

  // O log e o HTML recebido, no Finder/Explorer. O caminho vem do servidor, nunca da requisição.
  app.post('/api/links/descobrir/:id/abrir-log', async (req, reply) => {
    const pasta = pastaDoLogDaDescoberta((req.params as { id: string }).id) ?? pastaDosLogs(config);
    fs.mkdirSync(pasta, { recursive: true });
    abrirNoSistema(pasta);
    return reply.code(204).send();
  });

  app.get('/api/links/cursos/:id/log', async (req, reply) => {
    const arquivo = logDoCurso(db, (req.params as { id: string }).id);
    if (!arquivo) return reply.code(404).send({ error: 'not_found' });
    // As últimas linhas bastam para a janela; o arquivo inteiro fica na pasta do curso.
    const texto = fs.readFileSync(arquivo, 'utf8');
    return reply.type('text/plain; charset=utf-8').send(texto.slice(-20_000));
  });

  app.post('/api/links/cursos/:id/tentar-de-novo', async (req, reply) => {
    const ok = retentarImportacao(db, config, (req.params as { id: string }).id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });
}
