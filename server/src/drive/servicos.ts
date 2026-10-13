import type { Db } from '../db';
import type { AppConfig } from '../config';
import { criarClienteDrive, type ClienteDrive } from './api';
import { criarAuthDrive, type AuthDrive } from './auth';
import { credenciaisGoogle } from './credenciais';
import type { DepsIngestao } from '../scan/scan-drive';
import type { Fetch } from './tipos';
import { criarBaixador, type Baixador } from './baixar';

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
): ServicosDrive {
  const auth = criarAuthDrive({ db, fetch, credenciais: () => credenciaisGoogle(db) });
  const cliente = (resourceKeys?: string | null): ClienteDrive =>
    criarClienteDrive({
      fetch,
      apiKey: credenciaisGoogle(db).apiKey,
      token: auth.token,
      resourceKeys,
    });
  const baixador = criarBaixador({ db, config, cliente });
  return {
    auth,
    cliente,
    baixador,
    // Terminou de ler a pasta (curso novo ou re-escaneado): baixa o que faltar.
    ingestao: (resourceKeys) => ({
      cliente: cliente(resourceKeys),
      fetch,
      config,
      token: auth.token,
      depoisDeLer: (id) => baixador.enfileirar(id),
    }),
  };
}
