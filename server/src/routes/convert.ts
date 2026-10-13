import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { arquivoDoCurso } from './fs';
import { classifyPlayback, hasFfmpeg, probeDurationSec, probeFormat, remuxToMp4, transcodeToMp4, validateConverted, type Capacidades } from '../media/ffmpeg';

// Verificação e conversão de reprodução. A extensão .mp4 mente no acervo real
// (MPEG-TS renomeado; H.264 10-bit): estas rotas olham o formato DE DENTRO do
// arquivo e, quando dá para resolver sem perda (remux -c copy), convertem para
// DATA_DIR/converted/<lessonId>.mp4 — o acervo original nunca é tocado; o
// stream passa a servir o convertido automaticamente. Quando nem o remux resolve
// (H.264 10-bit, HEVC num player sem HEVC), o app recodifica para H.264 8-bit em
// segundo plano, com progresso: antes ele só mandava a pessoa ao HandBrake, e uma
// aula que não toca é o fim da linha para quem só quer assistir.
//
// O que o player toca vem da interface (`?hevc=1`): ela pergunta ao próprio
// <video>, e a mesma aula pode tocar no macOS e não no Windows.
const capacidadesDe = (q: unknown): Capacidades => ({ hevc: (q as { hevc?: string } | undefined)?.hevc === '1' });

// Uma recodificação por vez: ela já usa todos os núcleos, e duas ao mesmo tempo só
// deixariam as duas mais lentas.
interface Conversao { progresso: number; erro: string | null; ativa: boolean }
export async function convertRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }): Promise<void> {
  const { db, config } = opts;

  const lessonPath = (id: string): { file: string; courseId: string } | null => {
    const row = db
      .prepare('SELECT l.rel_path, l.course_id, c.root_path FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?')
      .get(id) as any;
    if (!row) return null;
    const file = arquivoDoCurso(row.root_path, row.rel_path);
    return file ? { file, courseId: row.course_id } : null;
  };

  // Curso do Drive ou do Telegram não tem arquivo local para probar nem converter.
  const aulaDoDrive = (id: string): { playable: boolean } | null => {
    const r = db
      .prepare("SELECT l.playable FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND c.source IN ('drive','telegram')")
      .get(id) as { playable: number } | undefined;
    return r ? { playable: !!r.playable } : null;
  };

  const setPlayable = db.prepare('UPDATE lessons SET playable=? WHERE id=?');
  const conversoes = new Map<string, Conversao>();
  let fila: Promise<void> = Promise.resolve();

  // Grava num arquivo temporário e só renomeia no fim: o stream serve
  // converted/<id>.mp4 assim que ele existe, e um arquivo pela metade tocaria cortado.
  const converterPara = async (id: string, gerar: (tmp: string) => Promise<void>, original: string, cap: Capacidades) => {
    fs.mkdirSync(config.convertedDir, { recursive: true });
    const out = path.join(config.convertedDir, `${id}.mp4`);
    const tmp = path.join(config.convertedDir, `${id}.parcial.mp4`);
    try {
      await gerar(tmp);
      // Validação obrigatória antes de servir: tocável de verdade + mesma duração.
      if (!(await validateConverted(original, tmp, cap))) throw new Error('validação falhou');
      fs.renameSync(tmp, out);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    setPlayable.run(1, id);
  };

  // Proba o arquivo e sincroniza o flag playable com a realidade. Retorna o
  // veredito para a UI decidir o que oferecer.
  const verdictFor = async (id: string, file: string, cap: Capacidades) => {
    const fmt = await probeFormat(file);
    if (!fmt) return null;
    const play = classifyPlayback(fmt, cap);
    setPlayable.run(play.playable ? 1 : 0, id);
    return play;
  };

  app.post('/api/lessons/:id/verify-playback', async (req, reply) => {
    const noDrive = aulaDoDrive((req.params as { id: string }).id);
    if (noDrive) return { playable: noDrive.playable, reason: noDrive.playable ? null : 'formato', remuxable: false };
    if (!hasFfmpeg()) return reply.code(503).send({ error: 'ffmpeg_unavailable' });
    const id = (req.params as { id: string }).id;
    const loc = lessonPath(id);
    if (!loc) return reply.code(404).send({ error: 'not_found' });
    if (!fs.existsSync(loc.file)) return reply.code(404).send({ error: 'file_missing' });
    // Já convertido: o stream serve a cópia, então a aula toca (o original continua igual).
    if (fs.existsSync(path.join(config.convertedDir, `${id}.mp4`))) {
      setPlayable.run(1, id);
      return { playable: true };
    }
    const play = await verdictFor(id, loc.file, capacidadesDe(req.query));
    if (!play) return reply.code(500).send({ error: 'probe_failed' });
    return play;
  });

  app.post('/api/lessons/:id/convert', async (req, reply) => {
    if (aulaDoDrive((req.params as { id: string }).id)) return reply.code(409).send({ error: 'curso-do-drive' });
    if (!hasFfmpeg()) return reply.code(503).send({ error: 'ffmpeg_unavailable' });
    const id = (req.params as { id: string }).id;
    const loc = lessonPath(id);
    if (!loc) return reply.code(404).send({ error: 'not_found' });
    if (!fs.existsSync(loc.file)) return reply.code(404).send({ error: 'file_missing' });
    const cap = capacidadesDe(req.query);
    const fmt = await probeFormat(loc.file);
    if (!fmt) return reply.code(500).send({ error: 'probe_failed' });
    const play = classifyPlayback(fmt, cap);
    setPlayable.run(play.playable ? 1 : 0, id);
    if (play.playable) return { status: 'already_playable' };

    const hevc = fmt.videoCodec === 'hevc' || fmt.videoCodec === 'h265';
    if (play.remuxable) {
      try {
        await converterPara(id, (tmp) => remuxToMp4(loc.file, tmp, { hevc }), loc.file, cap);
      } catch {
        return reply.code(500).send({ error: 'convert_failed' });
      }
      return { status: 'converted' };
    }

    // Recodificar leva minutos: responde já e a interface acompanha pelo GET.
    if (!conversoes.get(id)?.ativa) {
      const estado: Conversao = { progresso: 0, erro: null, ativa: true };
      conversoes.set(id, estado);
      fila = fila.then(async () => {
        try {
          const duracao = await probeDurationSec(loc.file);
          await converterPara(
            id,
            (tmp) => transcodeToMp4(loc.file, tmp, duracao, (f) => { estado.progresso = f; }),
            loc.file,
            cap,
          );
          estado.progresso = 1;
        } catch {
          estado.erro = 'convert_failed';
        } finally {
          estado.ativa = false;
        }
      });
    }
    return reply.code(202).send({ status: 'transcoding' });
  });

  app.get('/api/lessons/:id/convert', async (req) => {
    const id = (req.params as { id: string }).id;
    const c = conversoes.get(id);
    if (!c) return { status: 'idle' };
    if (c.ativa) return { status: 'transcoding', progresso: c.progresso };
    return c.erro ? { status: 'failed', error: c.erro } : { status: 'converted' };
  });
}
