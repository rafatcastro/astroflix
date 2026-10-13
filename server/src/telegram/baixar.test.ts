import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOCO } from './blocos';
import { baixarDoTelegram } from './baixar';
import type { ClienteTelegram } from './cliente';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-baixar-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TAMANHO = BLOCO * 2 + 300;
const conteudo = Buffer.from(Array.from({ length: TAMANHO }, (_, i) => i % 251));
const PEER = { tipo: 'canal' as const, id: '1', accessHash: '1' };

function cliente(offsets: number[], ultimoCheio = false) {
  return {
    async *baixar(_p: unknown, _msg: number, offset: number) {
      offsets.push(offset);
      for (let o = offset; o < TAMANHO; o += BLOCO) {
        // O Telegram pode mandar o último bloco inteiro, além do fim do arquivo.
        const fim = ultimoCheio ? o + BLOCO : Math.min(o + BLOCO, TAMANHO);
        const b = Buffer.alloc(fim - o);
        conteudo.copy(b, 0, o, Math.min(fim, TAMANHO));
        yield b;
      }
    },
  } as unknown as ClienteTelegram;
}

describe('download do Telegram', () => {
  it('baixa o arquivo inteiro e corta o excesso do último bloco', async () => {
    const offsets: number[] = [];
    const destino = path.join(tmp, 'a', 'aula.mp4');
    await baixarDoTelegram(cliente(offsets, true), PEER)('10', destino, TAMANHO);
    expect(fs.readFileSync(destino).equals(conteudo)).toBe(true);
    expect(offsets).toEqual([0]);
  });

  // O Telegram só aceita offset múltiplo do bloco: retomar volta ao último bloco inteiro.
  it('retoma o .part a partir do último bloco inteiro', async () => {
    const offsets: number[] = [];
    const destino = path.join(tmp, 'b', 'aula.mp4');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(`${destino}.part`, conteudo.subarray(0, BLOCO + 1234));
    await baixarDoTelegram(cliente(offsets), PEER)('10', destino, TAMANHO);
    expect(offsets).toEqual([BLOCO]);
    expect(fs.readFileSync(destino).equals(conteudo)).toBe(true);
    expect(fs.existsSync(`${destino}.part`)).toBe(false);
  });

  it('arquivo que veio menor que o tamanho não vira baixado', async () => {
    const destino = path.join(tmp, 'c', 'aula.mp4');
    await expect(baixarDoTelegram(cliente([]), PEER)('10', destino, TAMANHO + 5)).rejects.toThrow('sem-conexao');
    expect(fs.existsSync(destino)).toBe(false);
  });
});
