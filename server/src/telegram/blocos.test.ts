import { describe, expect, it } from 'vitest';
import { BLOCO, planoDeBlocos } from './blocos';

describe('planoDeBlocos', () => {
  it('BLOCO é 512 KB: divide 1 MB e é múltiplo de 4 KB (regra do upload.getFile)', () => {
    expect(BLOCO).toBe(512 * 1024);
    expect((1024 * 1024) % BLOCO).toBe(0);
    expect(BLOCO % 4096).toBe(0);
  });

  it('começo do arquivo: offset 0, nada a pular', () => {
    expect(planoDeBlocos(0, 99, 10_000_000)).toEqual({ offset: 0, pular: 0, entregar: 100 });
  });

  it('seek no meio: offset volta ao bloco, pula o excesso', () => {
    const start = BLOCO * 3 + 100;
    expect(planoDeBlocos(start, start + 9, 10_000_000)).toEqual({ offset: BLOCO * 3, pular: 100, entregar: 10 });
  });

  it('o fim é limitado pelo tamanho do arquivo', () => {
    expect(planoDeBlocos(0, 999_999_999, 1000)).toEqual({ offset: 0, pular: 0, entregar: 1000 });
  });
});
