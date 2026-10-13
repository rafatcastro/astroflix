import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { planoDeBlocos } from './blocos';
import type { ServicosTelegram } from './servicos';
import { falhaDoErro, statusDaFalhaTelegram } from './status';
import type { PeerTelegram } from './tipos';

export function respostaDeFalhaTelegram(e: unknown): { status: number; corpo: { error: string; esperaSeg?: number } } {
  const f = falhaDoErro(e);
  return { status: statusDaFalhaTelegram(f.tipo), corpo: f.esperaSeg ? { error: f.tipo, esperaSeg: f.esperaSeg } : { error: f.tipo } };
}

// Repasse sob demanda, como o do Drive: o vídeo nunca é baixado inteiro. O
// Range do player vira blocos alinhados do Telegram (ver blocos.ts), e só os
// bytes pedidos voltam, com 206 — é o que faz o seek funcionar.
export async function repassarDoTelegram(
  req: FastifyRequest,
  reply: FastifyReply,
  telegram: ServicosTelegram,
  alvo: { peer: PeerTelegram; msgId: number; tamanho: number; range: { start: number; end: number } | null },
  extra: { contentType: string; disposition?: string },
): Promise<FastifyReply> {
  // Seek e troca de aula fecham a conexão no meio: sem abortar, o download do
  // Telegram continuaria gastando banda à toa (mesma escuta do Drive).
  const ac = new AbortController();
  const aoFechar = () => {
    if (!reply.raw.writableFinished) ac.abort();
  };
  req.raw.on('aborted', aoFechar);
  reply.raw.on('close', aoFechar);

  const { start, end } = alvo.range ?? { start: 0, end: alvo.tamanho - 1 };
  const plano = planoDeBlocos(start, end, alvo.tamanho);

  // O primeiro bloco vem antes dos cabeçalhos: uma aula apagada ou uma sessão
  // caída ainda podem virar uma resposta JSON que o player sabe explicar.
  let iter: AsyncIterator<Buffer>;
  let primeiro: IteratorResult<Buffer>;
  try {
    const cliente = await telegram.cliente();
    iter = cliente.baixar(alvo.peer, alvo.msgId, plano.offset, ac.signal)[Symbol.asyncIterator]();
    primeiro = await iter.next();
  } catch (e) {
    if (ac.signal.aborted) return reply;
    const r = respostaDeFalhaTelegram(e);
    return reply.code(r.status).send(r.corpo);
  }

  reply.code(alvo.range ? 206 : 200);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', extra.contentType);
  reply.header('Content-Length', plano.entregar);
  if (alvo.range) reply.header('Content-Range', `bytes ${start}-${start + plano.entregar - 1}/${alvo.tamanho}`);
  if (extra.disposition) reply.header('Content-Disposition', extra.disposition);

  async function* corpo(): AsyncGenerator<Buffer> {
    let pular = plano.pular;
    let restante = plano.entregar;
    let r = primeiro;
    try {
      while (!r.done && restante > 0) {
        let b = r.value;
        if (pular >= b.length) {
          pular -= b.length;
        } else {
          if (pular) b = b.subarray(pular);
          pular = 0;
          if (b.length > restante) b = b.subarray(0, restante);
          restante -= b.length;
          yield b;
        }
        if (restante > 0) r = await iter.next();
      }
    } finally {
      ac.abort();
      await iter.return?.();
    }
  }
  return reply.send(Readable.from(corpo()));
}
