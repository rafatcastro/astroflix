import type { LinkTelegram, MensagemTelegram, PeerTelegram } from './tipos';

export interface GrupoTelegram {
  peer: PeerTelegram;
  titulo: string;
}

/** O que a prévia mostra de um grupo; foto e membros podem faltar (o Telegram nem sempre manda). */
export interface DetalhesGrupo {
  canal: boolean;
  membros: number | null;
  foto: Buffer | null;
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
  previa(peer: PeerTelegram): Promise<DetalhesGrupo & { videos: number; arquivos: number }>;
  /** O histórico inteiro do grupo, em qualquer ordem (montarCurso ordena). */
  mensagens(peer: PeerTelegram): Promise<MensagemTelegram[]>;
  /** Blocos de BLOCO bytes a partir de `offset` (múltiplo de BLOCO), até o fim do arquivo ou o abort. */
  baixar(peer: PeerTelegram, msgId: number, offset: number, signal: AbortSignal): AsyncIterable<Buffer>;
  /** A maior miniatura que o Telegram guarda com a mídia; null se não houver. */
  miniatura(peer: PeerTelegram, msgId: number): Promise<Buffer | null>;
}
