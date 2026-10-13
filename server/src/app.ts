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
import type { ServicosTelegram } from './telegram/servicos';
import { criarServicosTelegram } from './telegram/gramjs';
import { telegramRoutes } from './routes/telegram';

// `opts.fetch` e `opts.telegram` existem só para os testes injetarem um Google e
// um Telegram falsos. `retomarDownloads` só o app de verdade liga (index.ts): nos
// testes, nenhum download começa sozinho.
export function buildApp(
  config: AppConfig,
  db: Db,
  opts?: { fetch?: Fetch; telegram?: ServicosTelegram; retomarDownloads?: boolean },
): FastifyInstance {
  const app = Fastify({ logger: false });
  // Uma instância só: o auth guarda os states pendentes do login em memória, e
  // o callback precisa enxergar os mesmos que o início do fluxo criou.
  const drive = criarServicosDrive(db, config, opts?.fetch);
  // Uma instância só, pelo mesmo motivo: o login por QR vive em memória. Não
  // conecta nada até alguém usar (ver gramjs.ts).
  const telegram = opts?.telegram ?? criarServicosTelegram(db);

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
  app.register(coursesRoutes, { db, config, drive });
  app.register(lessonsRoutes, { db });
  app.register(streamRoutes, { db, config, drive, telegram });
  app.register(infoRoutes);
  app.register(thumbsRoutes, { db, config, drive, telegram });
  app.register(migrationRoutes, { db, config, drive, telegram });
  app.register(settingsRoutes, { db });
  app.register(collectionsRoutes, { db });
  app.register(convertRoutes, { db, config });
  app.register(resetRoutes, { db, config });
  app.register(materialsRoutes, { db, config, drive, telegram });
  app.register(swRoutes);
  app.register(backupRoutes, { db, config });
  app.register(driveRoutes, { db, drive });
  app.register(telegramRoutes, { db, config, telegram });
  // [ROUTES]

  // Ao abrir o app, os cursos do Drive continuam de onde o download parou.
  if (opts?.retomarDownloads) app.addHook('onReady', async () => drive.baixador.retomarTodos());

  // A interface vem embutida no build, não do disco — ver spa.ts.
  registrarSpa(app, WEB_ASSETS);

  return app;
}
