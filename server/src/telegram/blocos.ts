/**
 * Tamanho do pedaço pedido ao Telegram. O upload.getFile exige offset e limit
 * múltiplos de 4 KB, 1 MB divisível pelo limit e nenhum pedido cruzando uma
 * fronteira de 1 MB; blocos fixos de 512 KB, alinhados em 512 KB, cumprem tudo.
 */
export const BLOCO = 512 * 1024;

/**
 * O player pede bytes [start, end]; o Telegram só entrega blocos alinhados.
 * Baixa a partir do bloco que contém o start, descarta o excesso do primeiro e
 * entrega exatamente o que foi pedido.
 */
export function planoDeBlocos(start: number, end: number, tamanho: number): { offset: number; pular: number; entregar: number } {
  const fim = Math.min(end, tamanho - 1);
  const offset = Math.floor(start / BLOCO) * BLOCO;
  return { offset, pular: start - offset, entregar: fim - start + 1 };
}
