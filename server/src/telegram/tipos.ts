export type TipoFalhaTelegram =
  | 'sem-credenciais'
  | 'nao-autorizado'
  | 'link-invalido'
  | 'nao-encontrado'
  | 'sem-acesso'
  | 'convite'
  | 'convite-invalido'
  | 'aguardando-aprovacao'
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

/**
 * `mensagem` é o número depois do grupo (t.me/c/123/14078): num grupo com
 * tópicos, é o tópico (ou uma mensagem dentro dele), e o curso vira só aquele
 * tópico. `topico` vem de t.me/c/123/<tópico>/<mensagem> ou de ?thread=.
 */
export type LinkTelegram =
  | { tipo: 'publico'; usuario: string; mensagem?: number; topico?: number }
  | { tipo: 'privado'; canalId: string; mensagem?: number; topico?: number }
  | { tipo: 'convite'; hash: string }
  /** Escolhido da lista de conversas (tg:<peer>/<id>): grupo antigo e bot sem @ não têm link t.me. */
  | { tipo: 'id'; peer: PeerTelegram['tipo']; id: string };

/**
 * Onde o grupo mora, guardado em courses.telegram_peer. O accessHash é o que
 * permite achar um canal privado depois de reiniciar o app: a sessão do GramJS
 * não guarda o cache de entidades, e sem ele o id sozinho não basta.
 */
export interface PeerTelegram {
  /** 'usuario' = conversa com um bot (ou pessoa): os arquivos que ele mandou viram as aulas. */
  tipo: 'canal' | 'chat' | 'usuario';
  id: string;
  accessHash: string | null;
  /** Só este tópico do grupo (o id da mensagem que abre o tópico). Sem ele, o grupo inteiro. */
  topico?: number;
}

/** O recorte de uma mensagem que o resto do app usa — o cliente real e o falso dos testes produzem isto. */
export interface MensagemTelegram {
  id: number;
  /** Segundos desde a época (como o Telegram manda). */
  data: number;
  legenda: string;
  midia: MidiaTelegram | null;
  /** Num grupo com tópicos, o tópico da mensagem (1 = "General"); fora disso, ausente. */
  topico?: number;
}

/** Um tópico de um grupo com tópicos, para virar módulo do curso. */
export interface TopicoTelegram {
  id: number;
  titulo: string;
}

export interface MidiaTelegram {
  /** 'video' = mandado como vídeo; 'documento' = mandado como arquivo; 'foto' = foto (vira item do curso); 'outro' = figurinha, voz… */
  tipo: 'video' | 'documento' | 'foto' | 'outro';
  nome: string | null;
  tamanho: number;
  mime: string;
  duracaoSec: number | null;
  temMiniatura: boolean;
}
