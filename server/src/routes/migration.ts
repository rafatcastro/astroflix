import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { isWithinRoots } from './fs';
import { allowedRootsFor } from './settings';
import { previewReconcile, reconcileCourse } from '../scan/reconcile';
import { reconcileDriveCourse, importacaoDrive } from '../scan/scan-drive';
import { FalhaDrive } from '../drive/tipos';
import type { ServicosTelegram } from '../telegram/servicos';
import { respostaDeFalhaTelegram } from '../telegram/stream';
import { reconcileTelegramCourse } from '../scan/scan-telegram';
import type { ServicosDrive } from '../drive/servicos';
import { statusDaFalha, resourceKeyDoCurso } from '../drive/status';

export async function migrationRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: AppConfig; drive?: ServicosDrive; telegram?: ServicosTelegram },
): Promise<void> {
  const { db, config, drive, telegram } = opts;

  const origemDo = (id: string) =>
    db.prepare('SELECT source, drive_folder_id, drive_resource_key FROM courses WHERE id=?').get(id) as
      | { source: string; drive_folder_id: string | null; drive_resource_key: string | null }
      | undefined;

  const validatePath = (raw: unknown): { ok: true; path: string } | { ok: false; code: number } => {
    if (!raw || typeof raw !== 'string') return { ok: false, code: 400 };
    const target = path.resolve(raw);
    if (!isWithinRoots(target, allowedRootsFor(config, db))) return { ok: false, code: 403 };
    try {
      if (!fs.statSync(target).isDirectory()) return { ok: false, code: 400 };
    } catch {
      return { ok: false, code: 400 };
    }
    return { ok: true, path: target };
  };

  app.post('/api/courses/:id/repoint/preview', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const fonte = origemDo(id)?.source;
    if (fonte === 'drive' || fonte === 'telegram') return reply.code(409).send({ error: `curso-do-${fonte}` });
    const v = validatePath((req.body as { path?: string })?.path);
    if (!v.ok) return reply.code(v.code).send({ error: 'invalid_path' });
    const r = previewReconcile(db, config, id, { newRootPath: v.path });
    if ('status' in r) return reply.code(409).send(r);
    return r;
  });

  app.post('/api/courses/:id/repoint', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const fonte = origemDo(id)?.source;
    if (fonte === 'drive' || fonte === 'telegram') return reply.code(409).send({ error: `curso-do-${fonte}` });
    const v = validatePath((req.body as { path?: string })?.path);
    if (!v.ok) return reply.code(v.code).send({ error: 'invalid_path' });
    const r = reconcileCourse(db, config, id, { newRootPath: v.path });
    if ('status' in r) return reply.code(409).send(r);
    return r;
  });

  app.post('/api/courses/:id/rescan', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const curso = origemDo(id);
    if (curso?.source === 'drive') {
      if (!drive) return reply.code(503).send({ error: 'sem-conexao' });
      // Mesmo formato do cabeçalho de resource key usado ao criar o curso.
      // Duas leituras ao mesmo tempo gravariam planos diferentes por cima uma da outra.
      if (importacaoDrive(id).carregando) return reply.code(409).send({ error: 'carregando' });
      const rk = resourceKeyDoCurso(curso.drive_folder_id, curso.drive_resource_key);
      try {
        return await reconcileDriveCourse(db, drive.ingestao(rk), id);
      } catch (e) {
        if (e instanceof FalhaDrive) return reply.code(statusDaFalha(e.tipo)).send({ error: e.tipo });
        throw e;
      }
    }
    if (curso?.source === 'telegram') {
      if (!telegram) return reply.code(503).send({ error: 'sem-conexao' });
      try {
        return await reconcileTelegramCourse(db, { cliente: await telegram.cliente(), config }, id);
      } catch (e) {
        const r = respostaDeFalhaTelegram(e);
        return reply.code(r.status).send(r.corpo);
      }
    }
    const r = reconcileCourse(db, config, id);
    if ('status' in r) return reply.code(409).send(r);
    return r;
  });
}
