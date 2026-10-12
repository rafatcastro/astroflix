export type Fetch = typeof fetch;

export type TipoFalha =
  | 'sem-acesso'
  | 'cota-esgotada'
  | 'sem-conexao'
  | 'nao-autorizado'
  | 'nao-e-pasta'
  | 'link-invalido'
  | 'google';

// O tipo é o que a rota traduz em mensagem para a pessoa; o status HTTP do
// Google (quando houver) fica só para diagnóstico.
export class FalhaDrive extends Error {
  constructor(
    readonly tipo: TipoFalha,
    readonly status?: number,
  ) {
    super(tipo);
    this.name = 'FalhaDrive';
  }
}

export interface CredenciaisGoogle {
  clientId: string | null;
  clientSecret: string | null;
  apiKey: string | null;
}

export interface LinkDrive {
  folderId: string;
  resourceKey: string | null;
}
