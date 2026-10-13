import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { allowedRootsFor } from './settings';
import { VIDEO_EXTS } from '../scan/derive';

// Fronteira de segurança da navegação de pastas. Dois detalhes que custam caro no
// Windows: a raiz de uma unidade ("D:\") JÁ termina em separador, e concatenar
// outro produzia "D:\\" — prefixo que nenhum caminho tem, então a unidade inteira
// respondia 403 mesmo constando entre as permitidas. E o Windows não diferencia
// maiúsculas em caminho: "d:\cursos" e "D:\Cursos" são a mesma pasta, e recusar
// uma delas seria um 403 impossível de entender.
export function isWithinRoots(target: string, roots: string[]): boolean {
  const janela = process.platform === 'win32';
  const normalizar = (p: string): string => (janela ? p.toLowerCase() : p);
  const resolved = normalizar(path.resolve(target));
  return roots.some((root) => {
    const raiz = normalizar(root);
    if (resolved === raiz) return true;
    const base = raiz.endsWith(path.sep) ? raiz : raiz + path.sep;
    return resolved.startsWith(base);
  });
}

/**
 * Caminho absoluto de um arquivo do curso, ou null se o rel_path escapa da pasta.
 *
 * O rel_path normalmente vem do scan, mas o import de backup grava o que o
 * arquivo trouxer — e um "../../.ssh/id_rsa" transformaria o stream num leitor
 * de qualquer arquivo do disco. Toda rota que abre um arquivo do acervo passa
 * por aqui.
 */
export function arquivoDoCurso(rootPath: string, relPath: string): string | null {
  const raiz = path.resolve(rootPath);
  const alvo = path.resolve(raiz, relPath.split('/').join(path.sep));
  return alvo.startsWith(raiz.endsWith(path.sep) ? raiz : raiz + path.sep) ? alvo : null;
}

const ehVideo = (nome: string) => VIDEO_EXTS.has(path.extname(nome).toLowerCase());

// Para no primeiro vídeo: a pergunta é só "tem vídeo aqui dentro?", e uma estante
// de cursos num HD de rede pode ter milhares de arquivos.
function temVideo(dir: string): boolean {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entradas) {
    if (e.name.startsWith('.')) continue;
    if (e.isFile() && ehVideo(e.name)) return true;
  }
  return entradas.some((e) => e.isDirectory() && !e.name.startsWith('.') && temVideo(path.join(dir, e.name)));
}

export async function fsRoutes(app: FastifyInstance, opts: { config: AppConfig; db: Db }): Promise<void> {
  const { config, db } = opts;
  const roots = () => allowedRootsFor(config, db);

  app.get('/api/fs/browse', async (req, reply) => {
    const q = (req.query as { path?: string }).path;
    if (!q) {
      return { path: null, parent: null, dirs: roots().map((r) => ({ name: r, path: r })) };
    }
    const target = path.resolve(q);
    if (!isWithinRoots(target, roots())) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      reply.code(404);
      return { error: 'not_found' };
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const isRoot = roots().some((r) => path.resolve(target) === r);
    return { path: target, parent: isRoot ? null : path.dirname(target), dirs };
  });

  // O seletor nativo devolve só um caminho, sem dizer se é um curso ou uma pasta
  // de cursos. Com vídeo direto na pasta, é um curso; com vídeo só nas subpastas,
  // pode ser um curso com módulos ou vários cursos, e a interface pergunta.
  app.get('/api/fs/inspect', async (req, reply) => {
    const q = (req.query as { path?: string }).path;
    const target = q ? path.resolve(q) : '';
    if (!q || !isWithinRoots(target, roots())) {
      reply.code(403);
      return { error: 'forbidden' };
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      reply.code(404);
      return { error: 'not_found' };
    }
    const visiveis = entries.filter((e) => !e.name.startsWith('.'));
    return {
      videosNaRaiz: visiveis.some((e) => e.isFile() && ehVideo(e.name)),
      subpastasComVideo: visiveis.filter((e) => e.isDirectory() && temVideo(path.join(target, e.name))).length,
    };
  });
}
