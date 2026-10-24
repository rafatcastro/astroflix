import type { LinkTelegram, MensagemTelegram, PeerTelegram, TopicoTelegram } from './tipos';

export interface GrupoTelegram {
  peer: PeerTelegram;
  titulo: string;
}

/** O que a prévia mostra de um grupo; foto e membros podem faltar (o Telegram nem sempre manda). */
export interface DetalhesGrupo {
  canal: boolean;
  /** Conversa com um bot (link t.me/<bot>): a prévia não fala em membros. */
  bot?: boolean;
  membros: number | null;
  foto: Buffer | null;
}

/** Uma conversa da pessoa que pode virar curso, para a lista do diálogo do Telegram. */
export interface DialogoTelegram {
  /** O "link" que a prévia e a criação entendem (tg:<peer>/<id>). */
  chave: string;
  peer: PeerTelegram;
  titulo: string;
  tipo: 'canal' | 'grupo' | 'bot';
  membros: number | null;
}

export type Convite =
  | { tipo: 'ja-membro'; grupo: GrupoTelegram }
  | ({ tipo: 'convite'; titulo: string } & DetalhesGrupo);

/**
 * O que o app precisa do Telegram, e só isso. A implementação real (gramjs.ts)
 * fala MTProto com a conta da pessoa; os testes injetam uma falsa. Toda falha
 * sai como FalhaTelegram (ver status.ts).
 */
export interface ClienteTelegram {
  /** Link público ou privado → o grupo. Convite não passa por aqui (ver verConvite). */
  resolver(link: Exclude<LinkTelegram, { tipo: 'convite' }>): Promise<GrupoTelegram>;
  verConvite(hash: string): Promise<Convite>;
  entrarPorConvite(hash: string): Promise<GrupoTelegram>;
  /** Para a prévia: os detalhes e quantos vídeos e arquivos há, sem ler o histórico. */
  previa(peer: PeerTelegram): Promise<DetalhesGrupo & { videos: number; arquivos: number; fotos: number }>;
  /** Os grupos, canais e bots da conta, na ordem do app do Telegram (a conversa mais recente primeiro). */
  dialogos(): Promise<DialogoTelegram[]>;
  /**
   * Os tópicos do grupo, na ordem em que o Telegram os mostra (fixados primeiro,
   * depois a atividade mais recente). Vazio para canal, grupo sem tópicos ou um
   * curso que já é de um tópico só.
   */
  topicos(peer: PeerTelegram): Promise<TopicoTelegram[]>;
  /** O histórico inteiro do grupo, em qualquer ordem (montarCurso ordena). */
  mensagens(peer: PeerTelegram): Promise<MensagemTelegram[]>;
  /** Blocos de BLOCO bytes a partir de `offset` (múltiplo de BLOCO), até o fim do arquivo ou o abort. */
  baixar(peer: PeerTelegram, msgId: number, offset: number, signal: AbortSignal): AsyncIterable<Buffer>;
  /**
   * Lê de uma vez (até 100) as mensagens cujas miniaturas vão ser pedidas: um
   * pedido ao Telegram no lugar de um por capa. Opcional (os clientes falsos não têm).
   */
  prepararMiniaturas?(peer: PeerTelegram, msgIds: number[]): Promise<void>;
  /** A maior miniatura que o Telegram guarda com a mídia; null se não houver. Espera a vez dos pedidos da pessoa. */
  miniatura(peer: PeerTelegram, msgId: number): Promise<Buffer | null>;
}
