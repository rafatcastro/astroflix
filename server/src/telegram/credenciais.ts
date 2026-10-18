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

/** Precedência campo a campo: o que estava salvo (só até `descartarCredenciaisTelegram` apagar) → env → padrão do build. */
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

/**
 * O "app próprio do Telegram" saiu das Configurações: quem usa o app só clica em
 * Conectar. Ao abrir, apaga o api_id/api_hash que alguém tenha salvo; se eram
 * outros que não os efetivos sem eles, a sessão foi criada com o app antigo e
 * não vale mais: `encerrar` roda antes de apagar (ainda com a credencial velha,
 * que é a que consegue falar com o Telegram).
 */
export async function descartarCredenciaisTelegram(db: Db, encerrar: () => Promise<void>): Promise<void> {
  if (!db.prepare('SELECT 1 FROM settings WHERE key=?').get(CHAVE)) return;
  const com = credenciaisTelegram(db);
  const salvas = lerSalvas(db);
  const sem = { apiId: idValido(process.env.TELEGRAM_API_ID) ?? TELEGRAM_PADRAO.apiId ?? null, apiHash: process.env.TELEGRAM_API_HASH || TELEGRAM_PADRAO.apiHash || null };
  try {
    if ((salvas.apiId || salvas.apiHash) && (com.apiId !== sem.apiId || com.apiHash !== sem.apiHash)) await encerrar();
  } catch {
    // Sem rede: a sessão local some igual quando a pessoa conectar de novo.
  } finally {
    db.prepare('DELETE FROM settings WHERE key=?').run(CHAVE);
  }
}
