import fs from 'node:fs';
import { existsSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { capaNoDisco, setCourseCover } from '../media/thumbs';
import type { FilaCapas } from '../media/fila-capas';
import type { ServicosDrive } from '../drive/servicos';
import { capaDoDrive } from '../drive/capas';

function sendImage(reply: FastifyReply, filePath: string) {
  reply.header('Content-Type', 'image/jpeg');
  reply.header('Cache-Control', 'private, max-age=86400');
  return reply.send(fs.createReadStream(filePath));
}

export async function thumbsRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: AppConfig; capas: FilaCapas; drive?: ServicosDrive },
): Promise<void> {
  const { db, config, capas, drive } = opts;

  // Responde só com o que já está no disco. Sem capa, pede à fila e devolve 404 na
  // hora: a interface tenta de novo daqui a pouco (CapaAula.tsx). Esperar a rede
  // aqui prendia as conexões da janela com o servidor (ver fila-capas.ts).
  const capaOuPedir = (lessonId: string): string | null => {
    const out = capaNoDisco(db, config, lessonId);
    if (!out) capas.pedir(lessonId);
    return out;
  };

  // A aula do Drive: a capa que já estava no disco (de antes) vale; senão, vem do
  // Drive na hora, sem fila e sem gravar (drive/capas.ts). null = não é do Drive.
  const doDrive = async (reply: FastifyReply, lessonId: string): Promise<FastifyReply | null> => {
    const r = await capaDoDrive(db, drive, lessonId);
    if (r === null) return null;
    if (r === 'sem-capa') return reply.code(404).send({ error: 'no_thumb' });
    if (r === 'rede') return reply.code(503).send({ error: 'rede' });
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(r.bytes);
  };

  app.get('/api/lessons/:id/thumb', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const noDisco = capaNoDisco(db, config, id);
    if (noDisco) return sendImage(reply, noDisco);
    const remota = await doDrive(reply, id);
    if (remota) return remota;
    const out = capaOuPedir(id);
    if (!out) return reply.code(404).send({ error: 'no_thumb' });
    return sendImage(reply, out);
  });

  app.get('/api/courses/:id/cover', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const course = db.prepare('SELECT cover_path, poster_lesson_id FROM courses WHERE id=?').get(id) as any;
    if (!course) return reply.code(404).send({ error: 'not_found' });
    if (course.cover_path && existsSync(course.cover_path)) return sendImage(reply, course.cover_path);
    if (course.poster_lesson_id) {
      const noDisco = capaNoDisco(db, config, course.poster_lesson_id);
      if (noDisco) return sendImage(reply, noDisco);
      const remota = await doDrive(reply, course.poster_lesson_id);
      if (remota) return remota;
      const out = capaOuPedir(course.poster_lesson_id);
      if (out) return sendImage(reply, out);
    }
    return reply.code(404).send({ error: 'no_cover' });
  });

  app.post('/api/courses/:id/cover', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = req.body as { lessonId?: string; atSec?: number };
    if (!b?.lessonId || typeof b.atSec !== 'number') return reply.code(400).send({ error: 'bad_request' });
    // Escolher um quadro exige arquivo local e ffmpeg.
    if ((db.prepare('SELECT source FROM courses WHERE id=?').get(id) as { source: string } | undefined)?.source === 'drive') {
      return reply.code(409).send({ error: 'curso-do-drive' });
    }
    const r = await setCourseCover(db, config, id, b.lessonId, b.atSec);
    if (r === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (r === 'no_ffmpeg') return reply.code(503).send({ error: 'ffmpeg_required' });
    return reply.code(204).send();
  });
}
