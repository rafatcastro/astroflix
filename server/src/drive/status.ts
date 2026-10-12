import type { TipoFalha } from './tipos';

const STATUS: Partial<Record<TipoFalha, number>> = {
  'sem-acesso': 403,
  'cota-esgotada': 429,
  'sem-conexao': 503,
  'nao-autorizado': 401,
  'nao-e-pasta': 400,
  'link-invalido': 400,
};

// Um lugar só decide qual status HTTP cada falha do Drive vira, para rescan,
// stream e materiais não divergirem. O que não está mapeado (inclusive 'google')
// é falha do lado de lá: 502.
export function statusDaFalha(tipo: TipoFalha): number {
  return STATUS[tipo] ?? 502;
}

// O cabeçalho de resource key do Drive é "<pasta>/<chave>"; vale para qualquer
// download feito a partir de um curso daquela pasta.
export function resourceKeyDoCurso(folderId: string | null, resourceKey: string | null): string | null {
  return resourceKey && folderId ? `${folderId}/${resourceKey}` : null;
}
