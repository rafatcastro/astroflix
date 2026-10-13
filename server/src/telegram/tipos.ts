export type TipoFalhaTelegram =
  | 'sem-credenciais'
  | 'nao-autorizado'
  | 'link-invalido'
  | 'nao-encontrado'
  | 'sem-acesso'
  | 'convite'
  | 'convite-invalido'
  | 'sem-videos'
  | 'removido'
  | 'flood'
  | 'sem-conexao'
  | 'telegram';

// Como no Drive: o tipo é o que a rota traduz em mensagem para a pessoa. No
// flood, esperaSeg é o tempo que o próprio Telegram pediu.
export class FalhaTelegram extends Error {
  constructor(
    readonly tipo: TipoFalhaTelegram,
    readonly esperaSeg?: number,
  ) {
    super(tipo);
    this.name = 'FalhaTelegram';
  }
}

export interface CredenciaisTelegram {
  apiId: number | null;
  apiHash: string | null;
}

export type LinkTelegram =
  | { tipo: 'publico'; usuario: string }
  | { tipo: 'privado'; canalId: string }
  | { tipo: 'convite'; hash: string };

/**
 * Onde o grupo mora, guardado em courses.telegram_peer. O accessHash é o que
 * permite achar um canal privado depois de reiniciar o app: a sessão do GramJS
 * não guarda o cache de entidades, e sem ele o id sozinho não basta.
 */
export interface PeerTelegram {
  tipo: 'canal' | 'chat';
  id: string;
  accessHash: string | null;
}

/** O recorte de uma mensagem que o resto do app usa — o cliente real e o falso dos testes produzem isto. */
export interface MensagemTelegram {
  id: number;
  /** Segundos desde a época (como o Telegram manda). */
  data: number;
  legenda: string;
  midia: MidiaTelegram | null;
}

export interface MidiaTelegram {
  /** 'video' = mandado como vídeo; 'documento' = mandado como arquivo; 'outro' = foto, figurinha, voz… */
  tipo: 'video' | 'documento' | 'outro';
  nome: string | null;
  tamanho: number;
  mime: string;
  duracaoSec: number | null;
  temMiniatura: boolean;
}
