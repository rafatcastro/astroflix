import fs from 'node:fs';
import path from 'node:path';
import {
  classifyPlayback,
  probeDurationSec,
  probeFormat,
  remuxToMp4,
  transcodeToMp4,
  validateConverted,
  type Capacidades,
} from './ffmpeg';

// Uma recodificação por vez no app inteiro (player e download do Drive): ela já
// usa todos os núcleos, e duas ao mesmo tempo só deixariam as duas mais lentas.
let fila: Promise<unknown> = Promise.resolve();
export function naFilaDeRecodificacao<T>(tarefa: () => Promise<T>): Promise<T> {
  const p = fila.then(tarefa, tarefa);
  fila = p.catch(() => {});
  return p;
}

/**
 * Gera `out` a partir de `original` num arquivo temporário e só renomeia no fim:
 * o stream serve o convertido assim que ele existe, e um arquivo pela metade
 * tocaria cortado. Antes de servir, o resultado tem de tocar e ter a mesma duração.
 */
export async function converterPara(
  original: string,
  out: string,
  gerar: (tmp: string) => Promise<void>,
  cap: Capacidades,
): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out.replace(/\.mp4$/, '') + '.parcial.mp4';
  try {
    await gerar(tmp);
    if (!(await validateConverted(original, tmp, cap))) throw new Error('validação falhou');
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Deixa `original` pronto para o player: se já toca (ou o ffprobe não sabe dizer),
 * não faz nada; se não, remuxa ou recodifica para `out`. Devolve se converteu.
 */
export async function prepararParaTocar(
  original: string,
  out: string,
  cap: Capacidades,
  aoAvancar?: (fracao: number) => void,
): Promise<boolean> {
  const fmt = await probeFormat(original);
  if (!fmt) return false;
  const play = classifyPlayback(fmt, cap);
  if (play.playable) return false;
  const hevc = fmt.videoCodec === 'hevc' || fmt.videoCodec === 'h265';
  if (play.remuxable) {
    await converterPara(original, out, (tmp) => remuxToMp4(original, tmp, { hevc }), cap);
  } else {
    await naFilaDeRecodificacao(async () => {
      const duracao = await probeDurationSec(original);
      await converterPara(original, out, (tmp) => transcodeToMp4(original, tmp, duracao, aoAvancar), cap);
    });
  }
  return true;
}
