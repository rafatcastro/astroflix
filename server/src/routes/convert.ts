import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { arquivoDoCurso } from './fs';
import { classifyPlayback, hasFfmpeg, probeDurationSec, probeFormat, remuxToMp4, transcodeToMp4, type Capacidades } from '../media/ffmpeg';
import { converterPara as gerarConvertido, naFilaDeRecodificacao } from '../media/preparar';
import { adotarConvertido, arquivoBaixado, saidaDaConversao } from '../armazenamento';
import { salvarCapacidades } from '../drive/baixar';

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

interface Conversao { progresso: number; erro: string | null; ativa: boolean }
export async function convertRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }): Promise<void> {
  const { db, config } = opts;

  // A aula do Drive ou do Telegram já baixada tem arquivo local como qualquer
  // outra: o que vale para ela é a cópia na pasta de armazenamento.
  const lessonPath = (id: string): { file: string; courseId: string; remota?: boolean } | null => {
    const row = db
      .prepare('SELECT l.rel_path, l.course_id, c.root_path, c.source FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?')
      .get(id) as any;
    if (!row) return null;
    if (row.source === 'drive' || row.source === 'telegram') {
      const local = arquivoBaixado(db, config, 'aula', id);
      return local && !local.convertido ? { file: local.arquivo, courseId: row.course_id, remota: true } : null;
    }
    const file = arquivoDoCurso(row.root_path, row.rel_path);
    return file ? { file, courseId: row.course_id } : null;
  };

  // Aula do Drive ou do Telegram ainda não baixada: não há arquivo local para
  // probar nem converter.
  const aulaDoDrive = (id: string): { playable: boolean } | null => {
    const r = db
      .prepare("SELECT l.playable, l.rel_path, l.course_id, c.source FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND c.source IN ('drive','telegram')")
      .get(id) as { playable: number; rel_path: string; course_id: string; source: string } | undefined;
    if (!r) return null;
    if (arquivoBaixado(db, config, 'aula', id)) return null;
    return { playable: !!r.playable };
  };

  const setPlayable = db.prepare('UPDATE lessons SET playable=? WHERE id=?');
  const conversoes = new Map<string, Conversao>();

  // Aula baixada do Drive ou do Telegram: o convertido toma o lugar do original na
  // pasta de armazenamento (a pessoa vê um arquivo só). Curso local: o acervo
  // nunca é tocado, e o convertido fica em DATA_DIR/converted.
  const converterPara = async (
    id: string,
    gerar: (tmp: string) => Promise<void>,
    loc: { file: string; courseId: string; remota?: boolean },
    cap: Capacidades,
  ) => {
    if (loc.remota) {
      const out = saidaDaConversao(db, config, id, loc.file);
      await gerarConvertido(loc.file, out, gerar, cap);
      adotarConvertido(db, { tipo: 'aula', id, courseId: loc.courseId }, loc.file, out);
      return;
    }
    await gerarConvertido(loc.file, path.join(config.convertedDir, `${id}.mp4`), gerar, cap);
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
    // semArquivo: a interface explica que a aula ainda vai ser baixada (e convertida
    // sozinha, se precisar), em vez de oferecer uma conversão que não tem o que converter.
    if (noDrive) return { playable: noDrive.playable, reason: noDrive.playable ? null : 'formato', remuxable: false, semArquivo: true };
    const id = (req.params as { id: string }).id;
    // Já convertido: o stream serve a cópia, então a aula toca (o original continua igual).
    if (fs.existsSync(path.join(config.convertedDir, `${id}.mp4`)) || arquivoBaixado(db, config, 'aula', id)?.convertido) {
      setPlayable.run(1, id);
      return { playable: true };
    }
    if (!hasFfmpeg()) return reply.code(503).send({ error: 'ffmpeg_unavailable' });
    const loc = lessonPath(id);
    if (!loc) return reply.code(404).send({ error: 'not_found' });
    if (!fs.existsSync(loc.file)) return reply.code(404).send({ error: 'file_missing' });
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
        await converterPara(id, (tmp) => remuxToMp4(loc.file, tmp, { hevc }), loc, cap);
      } catch {
        return reply.code(500).send({ error: 'convert_failed' });
      }
      return { status: 'converted' };
    }

    // Recodificar leva minutos: responde já e a interface acompanha pelo GET.
    if (!conversoes.get(id)?.ativa) {
      const estado: Conversao = { progresso: 0, erro: null, ativa: true };
      conversoes.set(id, estado);
      void naFilaDeRecodificacao(async () => {
        try {
          const duracao = await probeDurationSec(loc.file);
          await converterPara(
            id,
            (tmp) => transcodeToMp4(loc.file, tmp, duracao, (f) => { estado.progresso = f; }),
            loc,
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

  // A interface conta ao abrir o que o player desta máquina toca: o download do
  // Drive converte em segundo plano, sem nenhum <video> por perto para perguntar.
  app.put('/api/player/capacidades', async (req, reply) => {
    const hevc = (req.body as { hevc?: unknown } | undefined)?.hevc;
    if (typeof hevc !== 'boolean') return reply.code(400).send({ error: 'corpo-invalido' });
    salvarCapacidades(db, { hevc });
    return reply.code(204).send();
  });

  app.get('/api/lessons/:id/convert', async (req) => {
    const id = (req.params as { id: string }).id;
    const c = conversoes.get(id);
    if (!c) return { status: 'idle' };
    if (c.ativa) return { status: 'transcoding', progresso: c.progresso };
    return c.erro ? { status: 'failed', error: c.erro } : { status: 'converted' };
  });
}
