import type { Db } from '../db';
import type { AppConfig } from '../config';
import { criarClienteDrive, type ClienteDrive } from './api';
import { criarAuthDrive, type AuthDrive } from './auth';
import { credenciaisGoogle } from './credenciais';
import type { DepsIngestao } from '../scan/scan-drive';
import type { Fetch } from './tipos';
import { baixarDoDrive, criarBaixador, type BaixarArquivo, type Baixador } from './baixar';
import { resourceKeyDoCurso } from './status';

export interface ServicosDrive {
  auth: AuthDrive;
  cliente(resourceKeys?: string | null): ClienteDrive;
  ingestao(resourceKeys?: string | null): DepsIngestao;
  baixador: Baixador;
}

// Um ponto só monta auth + cliente + deps a partir de db e fetch, para as rotas
// não repetirem a fiação e os testes injetarem um fetch falso num lugar só.
// A apiKey é lida a cada chamada: a pessoa pode salvá-la nas configurações
// sem reiniciar o app.
export function criarServicosDrive(
  db: Db,
  config: AppConfig,
  fetch: Fetch = globalThis.fetch,
  // O baixador é um só para o app inteiro (uma fila); os cursos do Telegram
  // entram nele por aqui.
  fonteTelegram?: (courseId: string) => Promise<BaixarArquivo | null>,
): ServicosDrive {
  const auth = criarAuthDrive({ db, fetch, credenciais: () => credenciaisGoogle(db) });
  const cliente = (resourceKeys?: string | null): ClienteDrive =>
    criarClienteDrive({
      fetch,
      apiKey: credenciaisGoogle(db).apiKey,
      token: auth.token,
      resourceKeys,
    });
  const fonte = async (courseId: string): Promise<BaixarArquivo | null> => {
    const c = db.prepare('SELECT source, drive_folder_id, drive_resource_key FROM courses WHERE id=?').get(courseId) as
      | { source: string; drive_folder_id: string | null; drive_resource_key: string | null }
      | undefined;
    if (c?.source === 'drive') return baixarDoDrive(cliente(resourceKeyDoCurso(c.drive_folder_id, c.drive_resource_key)));
    if (c?.source === 'telegram') return (await fonteTelegram?.(courseId)) ?? null;
    return null;
  };
  const baixador = criarBaixador({ db, config, fonte });
  return {
    auth,
    cliente,
    baixador,
    ingestao: (resourceKeys) => ({
      cliente: cliente(resourceKeys),
      fetch,
      config,
      token: auth.token,
    }),
  };
}
