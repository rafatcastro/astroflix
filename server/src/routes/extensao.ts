import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { EXTENSAO, APP_VERSION } from '../bundled';
import { adicionarAPlaylist, criarPlaylist, destinoDaPlaylist, criarSubPlaylist, listarPlaylists, moverAulaParaSubPlaylist, moverPlaylistParaDentro } from '../links/importar';
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

// O arquivo que a extensão lê de dentro da própria pasta (chrome.runtime.getURL)
// para achar a chave sozinha: antes a pessoa tinha de copiar a chave das
// Configurações e colar no popup. Só quem carregou esta pasta no Chrome o lê.
const ARQUIVO_DA_CHAVE = 'astroflix.json';

function gravarChave(db: Db, pasta: string): void {
  fs.writeFileSync(path.join(pasta, ARQUIVO_DA_CHAVE), JSON.stringify({ chave: chaveDaExtensao(db) }));
}

/** Grava a extensão embutida no build (a versão desta release) na pasta de dados. */
function gravarExtensao(db: Db, config: AppConfig): string {
  const pasta = pastaDaExtensao(config);
  fs.rmSync(pasta, { recursive: true, force: true });
  for (const [rel, base64] of Object.entries(EXTENSAO)) {
    const destino = path.join(pasta, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(base64, 'base64'));
  }
  gravarChave(db, pasta);
  return pasta;
}

/**
 * Ao abrir: quem já tem a extensão na pasta recebe a versão deste build (o Chrome
 * de quem a carregou lê os arquivos dali) e o arquivo da chave, que as versões
 * antigas não gravavam. Sem isso, quem atualizou o app continuava tendo de colar a chave.
 */
function atualizarExtensaoInstalada(db: Db, config: AppConfig): void {
  const pasta = pastaDaExtensao(config);
  const manifesto = path.join(pasta, 'manifest.json');
  if (!fs.existsSync(manifesto) || !EXTENSAO['manifest.json']) return;
  try {
    const embutido = Buffer.from(EXTENSAO['manifest.json'], 'base64').toString('utf8');
    if (fs.readFileSync(manifesto, 'utf8') !== embutido) gravarExtensao(db, config);
    else gravarChave(db, pasta);
  } catch {
    /* pasta sem permissão: fica como está, o popup ainda aceita a chave colada */
  }
}

export async function extensaoRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }): Promise<void> {
  const { db, config } = opts;
  atualizarExtensaoInstalada(db, config);

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
    const pasta = gravarExtensao(db, config);
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
    const onde = destinoDaPlaylist(db, (req.params as { id: string }).id, null);
    const r = onde ? criarSubPlaylist(db, onde.id, titulo) : null;
    return r ? reply.code(201).send(r) : reply.code(404).send({ error: 'playlist-nao-existe' });
  });

  // A playlist guardada na extensão foi movida para dentro de outra: onde ela está
  // agora, no formato da opção do popup ("id|subpasta").
  app.get('/api/extensao/playlists/:id/destino', async (req, reply) => {
    const q = req.query as { modulo?: string };
    const onde = destinoDaPlaylist(db, (req.params as { id: string }).id, q.modulo || null);
    return onde ? { valor: `${onde.id}|${onde.modulo ?? ''}` } : reply.code(404).send({ error: 'playlist-nao-existe' });
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
    // Playlist movida para dentro de outra: vai para o módulo dela lá.
    const onde = destinoDaPlaylist(db, (req.params as { id: string }).id, typeof b?.modulo === 'string' && b.modulo ? b.modulo : null);
    if (!onde) return reply.code(404).send({ error: 'playlist-nao-existe' });
    const r = adicionarAPlaylist(db, config, onde.id, {
      url,
      titulo: typeof b?.titulo === 'string' ? b.titulo.slice(0, 200) : url,
      pagina: typeof b?.pagina === 'string' && /^https?:\/\//i.test(b.pagina) ? b.pagina : null,
      cabecalhos,
      modulo: onde.modulo,
    });
    return r ? reply.code(201).send(r) : reply.code(404).send({ error: 'playlist-nao-existe' });
  });
}
