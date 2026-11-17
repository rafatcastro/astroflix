import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { EXTENSAO, APP_VERSION } from '../bundled';
import { adicionarAPlaylist, criarPlaylist, criarSubPlaylist, listarPlaylists, moverAulaParaSubPlaylist, moverPlaylistParaDentro } from '../links/importar';
import { acharNavegador } from '../links/navegador';
import { abrirNoSistema } from './armazenamento';

// A extensão do navegador (extensao/ no repositório): a pessoa abre a aula no
// Chrome, já logada no site, e manda o vídeo para uma playlist (um curso de link,
// links/importar.ts). As rotas /api/extensao/* respondem a chrome-extension://
// (ver guarda.ts) e só com a chave, gerada aqui e mostrada nas Configurações:
// qualquer extensão instalada consegue falar com localhost, mas só a que a pessoa
// pareou tem a chave.

const CHAVE = 'extensao.chave';

function chaveDaExtensao(db: Db): string {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE) as { value: string } | undefined;
  if (r?.value) return r.value;
  const nova = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(CHAVE, nova);
  return nova;
}

function chaveConfere(db: Db, req: FastifyRequest): boolean {
  const veio = req.headers['x-astroflix-chave'];
  if (typeof veio !== 'string') return false;
  const certa = Buffer.from(chaveDaExtensao(db));
  const dada = Buffer.from(veio);
  return certa.length === dada.length && timingSafeEqual(certa, dada);
}

const pastaDaExtensao = (config: AppConfig) => path.join(config.dataDir, 'extensao');

/** Grava a extensão embutida no build (a versão desta release) na pasta de dados. */
function gravarExtensao(config: AppConfig): string {
  const pasta = pastaDaExtensao(config);
  fs.rmSync(pasta, { recursive: true, force: true });
  for (const [rel, texto] of Object.entries(EXTENSAO)) {
    const destino = path.join(pasta, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, texto);
  }
  return pasta;
}

export async function extensaoRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }): Promise<void> {
  const { db, config } = opts;

  // ----- Para a interface do app (mesma origem) -----

  app.get('/api/links/extensao', async () => ({
    chave: chaveDaExtensao(db),
    pasta: pastaDaExtensao(config),
    instalada: fs.existsSync(path.join(pastaDaExtensao(config), 'manifest.json')),
    disponivel: Object.keys(EXTENSAO).length > 0,
  }));

  // Grava a pasta, mostra no Finder e abre chrome://extensions no Chrome da pessoa
  // (carregar uma extensão sem passar pela loja só se faz por lá).
  app.post('/api/links/extensao/instalar', async (_req, reply) => {
    if (!Object.keys(EXTENSAO).length) return reply.code(503).send({ error: 'sem-extensao-no-build' });
    const pasta = gravarExtensao(config);
    abrirNoSistema(pasta);
    const exe = acharNavegador();
    if (exe) {
      const p = spawn(exe, ['chrome://extensions'], { detached: true, stdio: 'ignore' });
      p.on('error', () => undefined);
      p.unref();
    }
    return { pasta };
  });

  // Uma playlist nova pelo app (Adicionar → "Playlist (pela extensão)").
  app.post('/api/links/playlists', async (req, reply) => {
    const b = req.body as { titulo?: unknown; categoriaId?: unknown } | undefined;
    const titulo = typeof b?.titulo === 'string' ? b.titulo.trim() : '';
    if (!titulo) return reply.code(400).send({ error: 'sem-titulo' });
    const categoriaId = typeof b?.categoriaId === 'string' && b.categoriaId ? b.categoriaId : null;
    if (categoriaId && !db.prepare('SELECT 1 FROM collections WHERE id=?').get(categoriaId)) return reply.code(400).send({ error: 'categoria' });
    return reply.code(201).send({ id: criarPlaylist(db, config, titulo, categoriaId) });
  });

  // Uma sub-playlist (módulo) dentro de uma playlist, pelo app.
  app.post('/api/links/playlists/:id/modulos', async (req, reply) => {
    const titulo = (req.body as { titulo?: unknown } | undefined)?.titulo;
    if (typeof titulo !== 'string' || !titulo.trim()) return reply.code(400).send({ error: 'sem-titulo' });
    const r = criarSubPlaylist(db, (req.params as { id: string }).id, titulo);
    return r ? reply.code(201).send(r) : reply.code(404).send({ error: 'playlist-nao-existe' });
  });

  // Mover a playlist para dentro de outra: ela vira uma sub-playlist (módulo) da outra.
  app.post('/api/links/playlists/:id/mover', async (req, reply) => {
    const destino = (req.body as { destino?: unknown } | undefined)?.destino;
    if (typeof destino !== 'string') return reply.code(400).send({ error: 'sem-destino' });
    const r = moverPlaylistParaDentro(db, config, (req.params as { id: string }).id, destino);
    if (typeof r === 'string') return reply.code(r === 'nao-existe' ? 404 : 400).send({ error: r });
    return r;
  });

  // Arrastar a aula para outra sub-playlist (modulo null = fora delas).
  app.post('/api/links/aulas/:id/mover', async (req, reply) => {
    const modulo = (req.body as { modulo?: unknown } | undefined)?.modulo;
    if (modulo !== null && typeof modulo !== 'string') return reply.code(400).send({ error: 'sem-modulo' });
    const r = moverAulaParaSubPlaylist(db, config, (req.params as { id: string }).id, modulo);
    return r === 'ok' ? reply.code(204).send() : reply.code(r === 'nao-existe' ? 404 : 400).send({ error: r });
  });

  // ----- Para a extensão (chrome-extension://, com a chave) -----

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/extensao/')) return;
    if (!chaveConfere(db, req)) return reply.code(401).send({ error: 'chave-errada' });
  });

  app.get('/api/extensao/ping', async () => ({ ok: true, versao: APP_VERSION }));

  app.get('/api/extensao/playlists', async () => listarPlaylists(db, config));

  app.post('/api/extensao/playlists', async (req, reply) => {
    const titulo = (req.body as { titulo?: unknown } | undefined)?.titulo;
    if (typeof titulo !== 'string' || !titulo.trim()) return reply.code(400).send({ error: 'sem-titulo' });
    return reply.code(201).send({ id: criarPlaylist(db, config, titulo.trim(), null) });
  });

  app.post('/api/extensao/playlists/:id/modulos', async (req, reply) => {
    const titulo = (req.body as { titulo?: unknown } | undefined)?.titulo;
    if (typeof titulo !== 'string' || !titulo.trim()) return reply.code(400).send({ error: 'sem-titulo' });
    const r = criarSubPlaylist(db, (req.params as { id: string }).id, titulo);
    return r ? reply.code(201).send(r) : reply.code(404).send({ error: 'playlist-nao-existe' });
  });

  app.post('/api/extensao/playlists/:id/itens', async (req, reply) => {
    const b = req.body as { url?: unknown; titulo?: unknown; pagina?: unknown; cabecalhos?: unknown; modulo?: unknown } | undefined;
    const url = typeof b?.url === 'string' && /^https?:\/\//i.test(b.url) ? b.url : null;
    if (!url) return reply.code(400).send({ error: 'url-invalida' });
    const cabecalhos = Array.isArray(b?.cabecalhos)
      ? (b.cabecalhos as Array<{ nome?: unknown; valor?: unknown }>)
          .filter((c) => typeof c?.nome === 'string' && typeof c?.valor === 'string' && /^[A-Za-z][A-Za-z0-9-]*$/.test(c.nome))
          // Sem quebra de linha: viraria outro argumento/cabeçalho no yt-dlp.
          .map((c) => ({ nome: c.nome as string, valor: (c.valor as string).replace(/[\r\n]+/g, ' ') }))
          .slice(0, 10)
      : [];
    const r = adicionarAPlaylist(db, config, (req.params as { id: string }).id, {
      url,
      titulo: typeof b?.titulo === 'string' ? b.titulo.slice(0, 200) : url,
      pagina: typeof b?.pagina === 'string' && /^https?:\/\//i.test(b.pagina) ? b.pagina : null,
      cabecalhos,
      modulo: typeof b?.modulo === 'string' && b.modulo ? b.modulo : null,
    });
    return r ? reply.code(201).send(r) : reply.code(404).send({ error: 'playlist-nao-existe' });
  });
}
