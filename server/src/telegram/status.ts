import { FalhaTelegram, type TipoFalhaTelegram } from './tipos';

const STATUS: Partial<Record<TipoFalhaTelegram, number>> = {
  'sem-credenciais': 503,
  'nao-autorizado': 401,
  'link-invalido': 400,
  'nao-encontrado': 404,
  'sem-acesso': 403,
  convite: 409,
  'convite-invalido': 410,
  'sem-videos': 422,
  removido: 404,
  flood: 429,
  'sem-conexao': 503,
};

// Um lugar só decide o status HTTP de cada falha, para criar, re-escanear,
// stream e materiais não divergirem. O que não está mapeado é falha do lado de lá: 502.
export function statusDaFalhaTelegram(tipo: TipoFalhaTelegram): number {
  return STATUS[tipo] ?? 502;
}

const POR_CODIGO: Array<[RegExp, TipoFalhaTelegram]> = [
  [/^(CHANNEL_PRIVATE|CHANNEL_INVALID|CHAT_FORBIDDEN|CHAT_ID_INVALID|PEER_ID_INVALID|CHANNEL_PUBLIC_GROUP_NA)$/, 'sem-acesso'],
  [/^(USERNAME_NOT_OCCUPIED|USERNAME_INVALID)$/, 'nao-encontrado'],
  [/^INVITE_HASH_(EXPIRED|INVALID|EMPTY)$/, 'convite-invalido'],
  [/^(AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|USER_DEACTIVATED_BAN|AUTH_KEY_DUPLICATED)$/, 'nao-autorizado'],
  [/^(MSG_ID_INVALID|MESSAGE_ID_INVALID|FILE_REFERENCE_EXPIRED)$/, 'removido'],
];

/** Traduz o que o GramJS lança (RPCError, FloodWaitError, erro de socket) para a falha do app. */
export function falhaDoErro(e: unknown): FalhaTelegram {
  if (e instanceof FalhaTelegram) return e;
  const err = e as { errorMessage?: unknown; seconds?: unknown; code?: unknown; message?: unknown } | null;
  const codigo = typeof err?.errorMessage === 'string' ? err.errorMessage : '';
  if (codigo.startsWith('FLOOD_WAIT') || codigo.startsWith('FLOOD_PREMIUM_WAIT')) {
    return new FalhaTelegram('flood', typeof err?.seconds === 'number' ? err.seconds : undefined);
  }
  for (const [re, tipo] of POR_CODIGO) if (re.test(codigo)) return new FalhaTelegram(tipo);
  const sock = typeof err?.code === 'string' ? err.code : '';
  const msg = typeof err?.message === 'string' ? err.message : '';
  if (/^(ECONN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)/.test(sock) || /not connected|timeout|disconnected/i.test(msg)) {
    return new FalhaTelegram('sem-conexao');
  }
  return new FalhaTelegram('telegram');
}
