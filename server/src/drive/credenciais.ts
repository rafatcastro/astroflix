import type { Db } from '../db/index';
import { GOOGLE_PADRAO } from '../bundled';
import type { CredenciaisGoogle } from './tipos';

const CHAVE = 'drive.credenciais';
const ENV: Record<keyof CredenciaisGoogle, string> = {
  clientId: 'GOOGLE_CLIENT_ID',
  clientSecret: 'GOOGLE_CLIENT_SECRET',
  apiKey: 'GOOGLE_API_KEY',
};
const CAMPOS = Object.keys(ENV) as (keyof CredenciaisGoogle)[];

/**
 * Precedência campo a campo: a env, depois o padrão embutido no build. As
 * Configurações tinham "Usar um app próprio do Google Cloud"; saiu: quem usa o
 * app conecta com o Google e pronto.
 */
export function credenciaisGoogle(
  _db: Db,
  env: NodeJS.ProcessEnv = process.env,
  padrao: CredenciaisGoogle = GOOGLE_PADRAO,
): CredenciaisGoogle {
  const r = {} as CredenciaisGoogle;
  for (const c of CAMPOS) r[c] = env[ENV[c]] || padrao[c] || null;
  return r;
}

/**
 * Apaga as credenciais que alguém salvou quando dava para usar um app próprio.
 * Devolve se havia client OAuth próprio: o refresh token pertence ao client que
 * o emitiu, e com o padrão ele só falharia com invalid_grant (é preciso conectar de novo).
 */
export function descartarCredenciaisSalvas(db: Db): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE) as { value: string } | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM settings WHERE key=?').run(CHAVE);
  try {
    const v = JSON.parse(row.value) as Partial<CredenciaisGoogle> | null;
    return !!(v?.clientId || v?.clientSecret);
  } catch {
    return false;
  }
}
