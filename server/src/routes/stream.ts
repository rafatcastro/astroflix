import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { allowedRootsFor } from './settings';
import { arquivoDoCurso, isWithinRoots } from './fs';
import type { ServicosDrive } from '../drive/servicos';
import { repassarDoDrive } from '../drive/stream';
import { arquivoLocalDaAula } from '../drive/local';
import { resourceKeyDoCurso } from '../drive/status';
import type { ServicosTelegram } from '../telegram/servicos';
import { repassarDoTelegram } from '../telegram/stream';
import type { PeerTelegram } from '../telegram/tipos';

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv', ts: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg',
};

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  let start: number;
  let end: number;
  if (s === '') {
    const n = Number(e);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (Number.isNaN(start) || start > end || start < 0) return null;
  return { start, end };
}

export async function streamRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: AppConfig; drive?: ServicosDrive; telegram?: ServicosTelegram },
): Promise<void> {
  const { db, config, drive, telegram } = opts;

  app.get('/api/lessons/:id/stream', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = db.prepare(`
      SELECT l.rel_path, l.container, l.remote_id, l.size_bytes, l.course_id, c.root_path, c.source, c.drive_folder_id, c.drive_resource_key, c.telegram_peer
      FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?
    `).get(id) as any;
    if (!row) return reply.code(404).send({ error: 'not_found' });

    // Aula do Drive ou do Telegram já baixada (ou convertida) toca do disco, como um curso local.
    const remota = row.source === 'drive' || row.source === 'telegram';
    const baixada = remota ? arquivoLocalDaAula(config, row.course_id, id, row.rel_path) : null;
    if (baixada) {
      return servirArquivo(req, reply, baixada.arquivo, baixada.convertido ? 'video/mp4' : (CONTENT_TYPES[row.container] ?? 'application/octet-stream'));
    }

    // Ainda não baixada: o vídeo vem direto do Drive. Raízes permitidas não se
    // aplicam (não há caminho do disco).
    if (row.source === 'drive') {
      if (!drive) return reply.code(503).send({ error: 'sem-conexao' });
      if (!row.remote_id) return reply.code(404).send({ error: 'file_missing' });
      const cliente = drive.cliente(resourceKeyDoCurso(row.drive_folder_id, row.drive_resource_key));
      return repassarDoDrive(req, reply, cliente, row.remote_id, {
        contentType: CONTENT_TYPES[row.container] ?? 'application/octet-stream',
      }, drive);
    }

    if (row.source === 'telegram') {
      if (!telegram) return reply.code(503).send({ error: 'sem-conexao' });
      if (!row.remote_id || !row.telegram_peer) return reply.code(404).send({ error: 'file_missing' });
      const tamanho = Number(row.size_bytes);
      const range = parseRange(req.headers.range, tamanho);
      if (req.headers.range && !range) {
        reply.header('Content-Range', `bytes */${tamanho}`);
        return reply.code(416).send();
      }
      return repassarDoTelegram(
        req,
        reply,
        telegram,
        { peer: JSON.parse(row.telegram_peer) as PeerTelegram, msgId: Number(row.remote_id), tamanho, range },
        { contentType: CONTENT_TYPES[row.container] ?? 'application/octet-stream' },
      );
    }

    // Mesma fronteira dos materiais: o arquivo precisa estar dentro da pasta do
    // curso E dentro das raízes permitidas — o caminho vem do banco, e o banco
    // também é escrito pelo import de backup.
    const original = arquivoDoCurso(row.root_path, row.rel_path);
    if (!original || !isWithinRoots(original, allowedRootsFor(config, db))) return reply.code(403).send({ error: 'forbidden' });

    // Se existe uma versão convertida (remux TS→MP4 etc.), ela tem prioridade —
    // o acervo original nunca é tocado; o convertido vive em DATA_DIR/converted.
    let filePath = original;
    let type = CONTENT_TYPES[row.container] ?? 'application/octet-stream';
    const converted = path.join(config.convertedDir, `${id}.mp4`);
    if (fs.existsSync(converted)) {
      filePath = converted;
      type = 'video/mp4';
    }
    return servirArquivo(req, reply, filePath, type);
  });
}

// Arquivo do disco com suporte a Range (é o que faz o seek funcionar; no PDF, o
// pdf.js pede só os pedaços que vai desenhar, e um livro grande abre sem ler tudo).
export function servirArquivo(req: FastifyRequest, reply: FastifyReply, filePath: string, type: string): FastifyReply {
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return reply.code(404).send({ error: 'file_missing' }); }

  const size = stat.size;
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', type);

  const range = parseRange(req.headers.range, size);
  if (range) {
    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    reply.header('Content-Length', range.end - range.start + 1);
    return reply.send(fs.createReadStream(filePath, { start: range.start, end: range.end }));
  }
  reply.code(200);
  reply.header('Content-Length', size);
  return reply.send(fs.createReadStream(filePath));
}
