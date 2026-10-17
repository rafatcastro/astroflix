import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';
import type { BaixarArquivo } from '../drive/baixar';
import { peerDoCurso } from '../scan/scan-telegram';
import { BLOCO } from './blocos';
import type { ClienteTelegram } from './cliente';
import type { ServicosTelegram } from './servicos';
import { FalhaTelegram, type PeerTelegram } from './tipos';

// Download das aulas do Telegram para o disco, pela mesma fila do Drive
// (drive/baixar.ts): assistir direto pelo Telegram é lento sem Premium, e cada
// seek pede blocos de novo. O Telegram só entrega blocos alinhados em BLOCO, então
// retomar um `.part` volta ao último bloco inteiro em vez de ao último byte.

export const baixarDoTelegram =
  (cliente: ClienteTelegram, peer: PeerTelegram): BaixarArquivo =>
  async (remoteId, destino, tamanho, signal) => {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const parcial = `${destino}.part`;
    const tinha = fs.existsSync(parcial) ? fs.statSync(parcial).size : 0;
    const inicio = Math.floor(tinha / BLOCO) * BLOCO;
    if (tinha !== inicio) fs.truncateSync(parcial, inicio);

    const ac = new AbortController();
    const parar = () => ac.abort();
    signal?.addEventListener('abort', parar);
    const saida = fs.createWriteStream(parcial, { flags: inicio ? 'a' : 'w' });
    try {
      for await (const bloco of cliente.baixar(peer, Number(remoteId), inicio, ac.signal)) {
        if (signal?.aborted) throw signal.reason;
        if (!saida.write(bloco)) await new Promise<void>((r) => saida.once('drain', () => r()));
      }
    } finally {
      signal?.removeEventListener('abort', parar);
      ac.abort();
      await new Promise<void>((resolve, reject) => saida.end((e?: Error | null) => (e ? reject(e) : resolve())));
    }
    // O último bloco pode vir completo além do fim do arquivo.
    const tem = fs.statSync(parcial).size;
    if (tamanho > 0 && tem > tamanho) fs.truncateSync(parcial, tamanho);
    // Arquivo truncado tocaria até o meio e pararia.
    if (tamanho > 0 && fs.statSync(parcial).size !== tamanho) {
      throw new FalhaTelegram('sem-conexao');
    }
    fs.renameSync(parcial, destino);
  };

/** A fonte de download de um curso do Telegram: conecta só quando há aula a baixar. */
export const fonteDoTelegram =
  (db: Db, servicos: ServicosTelegram) =>
  async (courseId: string): Promise<BaixarArquivo | null> => {
    const peer = peerDoCurso(db, courseId);
    if (!peer) return null;
    return baixarDoTelegram(await servicos.cliente(), peer);
  };
