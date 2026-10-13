import type { Db } from '../db/index';
import { TELEGRAM_PADRAO } from '../bundled';
import type { CredenciaisTelegram } from './tipos';

const CHAVE = 'telegram.credenciais';

function lerSalvas(db: Db): { apiId?: number; apiHash?: string } {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE) as { value: string } | undefined;
  if (!row) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === 'object' ? v : {};
  } catch {
    // JSON corrompido não pode derrubar o app: cai para env/padrão.
    return {};
  }
}

const idValido = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Precedência campo a campo, como no Google: Configurações → env → padrão do build. */
export function credenciaisTelegram(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  padrao: CredenciaisTelegram = TELEGRAM_PADRAO,
): CredenciaisTelegram {
  const salvas = lerSalvas(db);
  return {
    apiId: idValido(salvas.apiId) ?? idValido(env.TELEGRAM_API_ID) ?? padrao.apiId ?? null,
    apiHash: salvas.apiHash || env.TELEGRAM_API_HASH || padrao.apiHash || null,
  };
}

/** Valor vazio apaga o campo, devolvendo-o à env ou ao padrão. */
export function salvarCredenciaisTelegram(db: Db, parcial: { apiId?: number | string | null; apiHash?: string | null }): void {
  const atual = lerSalvas(db);
  if ('apiId' in parcial) {
    const id = idValido(parcial.apiId);
    if (id) atual.apiId = id;
    else delete atual.apiId;
  }
  if ('apiHash' in parcial) {
    if (parcial.apiHash) atual.apiHash = parcial.apiHash;
    else delete atual.apiHash;
  }
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(CHAVE, JSON.stringify(atual));
}
