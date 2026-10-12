import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db';
import { registrarSpa } from './spa';
import { registrarGuarda } from './guarda';
import { WEB_ASSETS } from './bundled';
import type { AppConfig } from './config';
import { healthRoutes } from './routes/health';
import { fsRoutes } from './routes/fs';
import { coursesRoutes } from './routes/courses';
import { lessonsRoutes } from './routes/lessons';
import { streamRoutes } from './routes/stream';
import { infoRoutes } from './routes/info';
import { thumbsRoutes } from './routes/thumbs';
import { migrationRoutes } from './routes/migration';
import { settingsRoutes } from './routes/settings';
import { collectionsRoutes } from './routes/collections';
import { convertRoutes } from './routes/convert';
import { resetRoutes } from './routes/reset';
import { materialsRoutes } from './routes/materials';
import { swRoutes } from './routes/sw';
import { backupRoutes } from './routes/backup';

import { criarServicosDrive } from './drive/servicos';
import type { Fetch } from './drive/tipos';
import { driveRoutes } from './routes/drive';

// `opts.fetch` existe só para os testes injetarem um Google falso.
export function buildApp(config: AppConfig, db: Db, opts?: { fetch?: Fetch }): FastifyInstance {
  const app = Fastify({ logger: false });
  // Uma instância só: o auth guarda os states pendentes do login em memória, e
  // o callback precisa enxergar os mesmos que o início do fluxo criou.
  const drive = criarServicosDrive(db, config, opts?.fetch);

  // Antes de qualquer rota: recusa Host e Origin que não são desta máquina — ver guarda.ts.
  registrarGuarda(app);

  // Tolera corpo vazio em application/json: um POST/DELETE sem corpo (ex.: rescan, excluir)
  // não deve falhar com FST_ERR_CTP_EMPTY_JSON_BODY — trata corpo vazio como indefinido.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = (body as string).trim();
    if (raw === '') return done(null, undefined);
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.register(healthRoutes);
  app.register(fsRoutes, { config, db });
  app.register(coursesRoutes, { db, config });
  app.register(lessonsRoutes, { db });
  app.register(streamRoutes, { db, config, drive });
  app.register(infoRoutes);
  app.register(thumbsRoutes, { db, config, drive });
  app.register(migrationRoutes, { db, config, drive });
  app.register(settingsRoutes, { db });
  app.register(collectionsRoutes, { db });
  app.register(convertRoutes, { db, config });
  app.register(resetRoutes, { db, config });
  app.register(materialsRoutes, { db, config, drive });
  app.register(swRoutes);
  app.register(backupRoutes, { db, config });
  app.register(driveRoutes, { db, drive });
  // [ROUTES]

  // A interface vem embutida no build, não do disco — ver spa.ts.
  registrarSpa(app, WEB_ASSETS);

  return app;
}
