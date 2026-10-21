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
import { apagarBaixados } from './armazenamento';
import type { Fetch } from './drive/tipos';
import { driveRoutes } from './routes/drive';
import type { ServicosTelegram } from './telegram/servicos';
import { criarServicosTelegram } from './telegram/gramjs';
import { telegramRoutes } from './routes/telegram';
import { fonteDoTelegram } from './telegram/baixar';
import { criarClienteAnki, type ClienteAnki } from './anki/cliente';
import { criarServicosAnki } from './anki/servicos';
import { flashcardsRoutes } from './routes/flashcards';
import { configSupabase, criarClienteSupabase, type ClienteSupabase } from './nuvem/cliente';
import { criarServicosConta } from './nuvem/conta';
import { estudoRoutes } from './routes/estudo';
import { criarSincronizador, type Sincronizador } from './nuvem/sincronizar';
import { contaRoutes } from './routes/conta';
import { documentosRoutes } from './routes/documentos';
import { credenciaisGoogle, descartarCredenciaisSalvas } from './drive/credenciais';
import { migrarCacheAntigo } from './armazenamento';
import { descartarCredenciaisTelegram } from './telegram/credenciais';
import { armazenamentoRoutes } from './routes/armazenamento';

// `opts.fetch`, `opts.telegram` e `opts.anki` existem só para os testes injetarem
// um Google, um Telegram e um Anki falsos. `retomarDownloads` só o app de verdade liga (index.ts): nos
// testes, nenhum download começa sozinho.
export function buildApp(
  config: AppConfig,
  db: Db,
  opts?: {
    fetch?: Fetch;
    telegram?: ServicosTelegram;
    anki?: ClienteAnki;
    retomarDownloads?: boolean;
    /** Supabase falso nos testes; null = app sem conta. Omitido: o projeto do build. */
    supabase?: ClienteSupabase | null;
    /** Só o app de verdade (index.ts): sem conta, nenhuma rota de dados responde; e sincroniza a cada minuto. */
    exigirConta?: boolean;
    /** Só o app de verdade: avisa a casca desktop quando um "Baixar" começa ou termina. */
    aoBaixar?: (baixando: boolean) => void;
  },
): FastifyInstance {
  const app = Fastify({ logger: false });
  // Uma instância só: o login por QR vive em memória. Não conecta nada até
  // alguém usar (ver gramjs.ts).
  const telegram = opts?.telegram ?? criarServicosTelegram(db);
  // Uma instância só, pelo mesmo motivo: o auth guarda os states pendentes do
  // login em memória, e o callback precisa enxergar os mesmos que o início do
  // fluxo criou. Ela também tem a fila de downloads, do Drive e do Telegram.
  const drive = criarServicosDrive(db, config, opts?.fetch, fonteDoTelegram(db, telegram));
  // Uma instância só: a fila de envio ao Anki não pode ter duas cópias correndo.
  // Nada fala com o Anki até alguém abrir os flashcards.
  const anki = criarServicosAnki(db, opts?.anki ?? criarClienteAnki());

  // Conta e nuvem (nuvem/). Sem projeto Supabase no build, o app roda sem conta.
  const cfgNuvem = configSupabase();
  const supabase =
    opts?.supabase !== undefined ? opts.supabase : cfgNuvem ? criarClienteSupabase(cfgNuvem, opts?.fetch ?? globalThis.fetch) : null;
  let sinc: Sincronizador | null = null;
  const conta = criarServicosConta({
    db,
    fetch: opts?.fetch ?? globalThis.fetch,
    supabase,
    credenciaisGoogle: () => credenciaisGoogle(db),
    aoConcederDrive: (t) => drive.auth.adotar(t),
    aoEntrar: (s) => {
      sinc?.aoEntrar(s.userId);
      if (opts?.exigirConta) sinc?.iniciar();
    },
  });
  if (supabase)
    sinc = criarSincronizador({
      db,
      supabase,
      token: () => conta.token(),
      // Como excluir aqui: sem o curso, ninguém acharia (nem removeria) esses arquivos pelo app.
      aoExcluirCurso: (id) => {
        drive.baixador.cancelar(id);
        apagarBaixados(db, config, id);
      },
    });

  // Antes de qualquer rota: recusa Host e Origin que não são desta máquina — ver guarda.ts.
  registrarGuarda(app);

  // Login obrigatório: a trava é aqui, no servidor, e não só na tela. Sem sessão,
  // só a própria conta (para entrar) e o que não é dado da pessoa respondem.
  if (opts?.exigirConta && conta.configurada) {
    const livres = ['/api/conta', '/api/health', '/api/info'];
    app.addHook('onRequest', async (req, reply) => {
      const url = req.url.split('?')[0];
      if (!url.startsWith('/api/') || livres.some((l) => url === l || url.startsWith(`${l}/`))) return;
      if (!conta.estado().entrou) return reply.code(401).send({ error: 'precisa-entrar' });
    });
  }

  // Mudou algo (não-GET): sobe logo, sem esperar a volta do minuto. O progresso
  // salva a cada poucos segundos, então junta numa subida só.
  let subidaMarcada: NodeJS.Timeout | null = null;
  app.addHook('onResponse', async (req) => {
    if (!sinc || req.method === 'GET' || !req.url.startsWith('/api/') || req.url.startsWith('/api/conta')) return;
    if (subidaMarcada || !conta.estado().entrou) return;
    subidaMarcada = setTimeout(() => {
      subidaMarcada = null;
      void sinc?.sincronizar();
    }, 3000);
    subidaMarcada.unref();
  });

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
  app.register(lessonsRoutes, { db, config, drive });
  app.register(streamRoutes, { db, config, drive, telegram });
  app.register(infoRoutes);
  app.register(thumbsRoutes, { db, config, drive, telegram });
  app.register(migrationRoutes, { db, config, drive, telegram });
  app.register(settingsRoutes, { db });
  app.register(collectionsRoutes, { db });
  app.register(convertRoutes, { db, config });
  app.register(resetRoutes, { db, config, drive });
  app.register(materialsRoutes, { db, config, drive, telegram });
  app.register(swRoutes);
  app.register(backupRoutes, { db, config });
  app.register(driveRoutes, { db, drive });
  app.register(telegramRoutes, { db, config, telegram });
  app.register(flashcardsRoutes, { db, anki });
  app.register(contaRoutes, { conta, sinc });
  app.register(documentosRoutes, { db, config, drive });
  app.register(estudoRoutes, { db });
  app.register(armazenamentoRoutes, { db, config, drive });
  // [ROUTES]

  if (opts?.retomarDownloads) {
    app.addHook('onReady', async () => {
      // O cache antigo (nomes por id) vira a pasta de armazenamento antes de a fila começar.
      migrarCacheAntigo(db, config);
      // O app próprio do Google Cloud saiu das Configurações: a conexão feita com ele não vale mais.
      if (descartarCredenciaisSalvas(db)) await drive.auth.desconectar({ revogar: false });
      // O mesmo com o app próprio do Telegram; sem esperar, porque encerrar a sessão vai à rede.
      void descartarCredenciaisTelegram(db, () => telegram.aoTrocarCredenciais());
      // Os "Baixar" que o app fechou no meio continuam sozinhos.
      drive.baixador.retomar();
    });
  }
  // A casca do desktop impede o sistema de dormir (e o macOS de pôr o app em
  // App Nap) enquanto baixa, e deixa a janela fechar sem matar o download.
  if (opts?.aoBaixar) {
    const avisar = opts.aoBaixar;
    let baixando = false;
    const conferir = setInterval(() => {
      const agora = drive.baixador.ocupado();
      if (agora !== baixando) avisar((baixando = agora));
    }, 2000);
    conferir.unref();
    app.addHook('onClose', async () => clearInterval(conferir));
  }
  // Já entrou numa abertura anterior: sincroniza ao abrir e a cada minuto.
  if (opts?.exigirConta) app.addHook('onReady', async () => {
    if (conta.estado().entrou) sinc?.iniciar();
  });
  app.addHook('onClose', async () => sinc?.parar());

  // A interface vem embutida no build, não do disco — ver spa.ts.
  registrarSpa(app, WEB_ASSETS);

  return app;
}
