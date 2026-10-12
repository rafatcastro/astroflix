import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ClienteDrive } from './api';
import { FalhaDrive } from './tipos';
import { statusDaFalha } from './status';

// Repasse sob demanda: o vídeo/material nunca é baixado inteiro para o disco.
// O Range do navegador vai direto ao Drive, e o status (200/206/416) e os
// cabeçalhos de volta, para o seek funcionar igual ao arquivo local.
export async function repassarDoDrive(
  req: FastifyRequest,
  reply: FastifyReply,
  cliente: ClienteDrive,
  remoteId: string,
  extra?: { contentType?: string; disposition?: string },
): Promise<FastifyReply> {
  // Seek e troca de aula fecham a conexão no meio do vídeo; sem abortar, o
  // download do Drive continuaria gastando cota à toa. Escutamos o fechamento
  // do reply.raw (e só abortamos se a resposta não terminou): o 'close' do
  // req.raw dispara cedo demais em GET, assim que o pedido é lido.
  const ac = new AbortController();
  const aoFechar = () => { if (!reply.raw.writableFinished) ac.abort(); };
  req.raw.on('aborted', aoFechar);
  reply.raw.on('close', aoFechar);

  let res: Response;
  try {
    res = await cliente.baixar(remoteId, req.headers.range, ac.signal);
  } catch (e) {
    if (e instanceof FalhaDrive) return reply.code(statusDaFalha(e.tipo)).send({ error: e.tipo });
    throw e;
  }

  reply.code(res.status);
  reply.header('Accept-Ranges', 'bytes');
  const contentRange = res.headers.get('content-range');
  if (contentRange) reply.header('Content-Range', contentRange);
  const contentLength = res.headers.get('content-length');
  if (contentLength) reply.header('Content-Length', contentLength);
  const contentType = extra?.contentType ?? res.headers.get('content-type');
  if (contentType) reply.header('Content-Type', contentType);
  if (extra?.disposition) reply.header('Content-Disposition', extra.disposition);

  if (!res.body) return reply.send();
  return reply.send(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream));
}
