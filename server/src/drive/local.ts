import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';

// Onde ficam as cópias locais de um curso do Drive: DATA_DIR/downloads/<curso>/.
// O nome é o id da aula (ou do material), não o do arquivo no Drive: nomes de lá
// podem ter qualquer caractere e repetir, e o id já é único e estável.

// A extensão vem do nome no Drive, que o dono da pasta controla: só passa uma
// extensão comum, nunca algo como "/../".
const extensao = (relPath: string): string => {
  const ext = path.extname(relPath).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
};

export const pastaBaixadaDoCurso = (config: AppConfig, courseId: string): string =>
  path.join(config.downloadsDir, courseId);

export const arquivoBaixadoDaAula = (config: AppConfig, courseId: string, lessonId: string, relPath: string): string =>
  path.join(pastaBaixadaDoCurso(config, courseId), `${lessonId}${extensao(relPath)}`);

export const arquivoBaixadoDoMaterial = (config: AppConfig, courseId: string, materialId: string, relPath: string): string =>
  path.join(pastaBaixadaDoCurso(config, courseId), `m-${materialId}${extensao(relPath)}`);

/**
 * O arquivo que o player deve usar no lugar do Drive, se já existe: o convertido
 * (quando o baixado não tocava) ou o baixado. null = ainda não chegou.
 */
export function arquivoLocalDaAula(
  config: AppConfig,
  courseId: string,
  lessonId: string,
  relPath: string,
): { arquivo: string; convertido: boolean } | null {
  // Configs montadas à mão nos testes antigos não têm a pasta: sem ela, nada é local.
  if (!config.downloadsDir) return null;
  const convertido = path.join(config.convertedDir, `${lessonId}.mp4`);
  if (fs.existsSync(convertido)) return { arquivo: convertido, convertido: true };
  const baixado = arquivoBaixadoDaAula(config, courseId, lessonId, relPath);
  return fs.existsSync(baixado) ? { arquivo: baixado, convertido: false } : null;
}
