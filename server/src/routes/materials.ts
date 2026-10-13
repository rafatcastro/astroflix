import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { allowedRootsFor } from './settings';
import { arquivoDoCurso, isWithinRoots } from './fs';
import { parseRange } from './stream';
import type { ServicosTelegram } from '../telegram/servicos';
import { repassarDoTelegram } from '../telegram/stream';
import type { PeerTelegram } from '../telegram/tipos';
import type { ServicosDrive } from '../drive/servicos';
import { repassarDoDrive } from '../drive/stream';
import { resourceKeyDoCurso } from '../drive/status';

// Content-types dos materiais adicionais. PDF/imagem servem INLINE (para o leitor
// embutido e o <img> renderizarem); o resto vai como download.
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  epub: 'application/epub+zip',
};
const INLINE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'md']);

export async function materialsRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: AppConfig; drive?: ServicosDrive; telegram?: ServicosTelegram },
): Promise<void> {
  const { db, config, drive, telegram } = opts;

  // Serve o arquivo de um material. O caminho vem do BANCO (não do usuário), e
  // ainda assim é validado contra as raízes — o app nunca sai do acervo. ?download=1
  // força o "salvar como" (para zip/docs); senão inline (PDF/imagem no leitor).
  app.get('/api/materials/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = db.prepare(
      `SELECT m.rel_path, m.remote_id, m.size_bytes, c.root_path, c.source, c.drive_folder_id, c.drive_resource_key, c.telegram_peer
       FROM materials m JOIN courses c ON c.id=m.course_id WHERE m.id=?`,
    ).get(id) as
      | {
          rel_path: string;
          remote_id: string | null;
          size_bytes: number;
          root_path: string;
          source: string;
          drive_folder_id: string | null;
          drive_resource_key: string | null;
          telegram_peer: string | null;
        }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const ext = path.extname(row.rel_path).slice(1).toLowerCase();
    const type = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    const name = row.rel_path.split('/').pop() ?? 'arquivo';
    const forceDownload = (req.query as { download?: string }).download === '1' || !INLINE.has(ext);
    const disposition = `${forceDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`;
    // Mesmos cabeçalhos de segurança para qualquer origem do arquivo.
    const protegido = () => {
      // O material vem de pastas baixadas sabe-se lá de onde e é servido na MESMA
      // origem da API. Um SVG aberto direto na aba rodaria o <script> dele com
      // acesso a tudo; nosniff impede o navegador de "adivinhar" HTML num .txt.
      reply.header('X-Content-Type-Options', 'nosniff');
      if (ext === 'svg') reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    };

    if (row.source === 'drive') {
      if (!drive) return reply.code(503).send({ error: 'sem-conexao' });
      if (!row.remote_id) return reply.code(404).send({ error: 'file_missing' });
      protegido();
      const cliente = drive.cliente(resourceKeyDoCurso(row.drive_folder_id, row.drive_resource_key));
      return repassarDoDrive(req, reply, cliente, row.remote_id, { contentType: type, disposition }, drive);
    }

    if (row.source === 'telegram') {
      if (!telegram) return reply.code(503).send({ error: 'sem-conexao' });
      if (!row.remote_id || !row.telegram_peer) return reply.code(404).send({ error: 'file_missing' });
      protegido();
      // O nome no disco não carrega o prefixo do id da mensagem.
      const nome = name.replace(/^\d{10}-/, '');
      return repassarDoTelegram(
        req,
        reply,
        telegram,
        { peer: JSON.parse(row.telegram_peer) as PeerTelegram, msgId: Number(row.remote_id), tamanho: Number(row.size_bytes), range: null },
        { contentType: type, disposition: `${forceDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nome)}` },
      );
    }

    const filePath = arquivoDoCurso(row.root_path, row.rel_path);
    if (!filePath || !isWithinRoots(filePath, allowedRootsFor(config, db))) return reply.code(403).send({ error: 'forbidden' });
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return reply.code(404).send({ error: 'file_missing' });
    }

    const size = stat.size;
    reply.header('Content-Type', type);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', disposition);
    protegido();

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
  });
}
