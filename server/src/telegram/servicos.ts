import type { ClienteTelegram } from './cliente';

export type EstadoLogin =
  | { fase: 'parado' }
  | { fase: 'qr'; url: string; expiraEm: number }
  | { fase: 'senha'; dica: string | null; erro: 'senha-incorreta' | null }
  | { fase: 'conectado'; usuario: string | null }
  | { fase: 'erro'; erro: string };

export interface StatusTelegram {
  conectado: boolean;
  usuario: string | null;
  credenciais: { apiId: boolean; apiHash: boolean };
}

/**
 * A fronteira entre as rotas e o Telegram. A real (gramjs.ts) só cria conexão
 * sob demanda — quem nunca cola um link do Telegram nunca abre socket nenhum.
 */
export interface ServicosTelegram {
  /** Sem rede: lê só o que está salvo. */
  status(): StatusTelegram;
  /** Cliente conectado e autorizado; FalhaTelegram('nao-autorizado' | 'sem-credenciais') se não der. */
  cliente(): Promise<ClienteTelegram>;
  login: {
    /** Começa (ou recomeça) o login por QR e devolve o primeiro estado. */
    iniciar(): Promise<EstadoLogin>;
    estado(): EstadoLogin;
    senha(senha: string): Promise<EstadoLogin>;
    cancelar(): void;
  };
  /** Encerra a sessão no Telegram (se der) e apaga a local. */
  desconectar(): Promise<void>;
  /** Credenciais trocadas nas Configurações: a sessão antiga não vale mais. */
  aoTrocarCredenciais(): Promise<void>;
}
