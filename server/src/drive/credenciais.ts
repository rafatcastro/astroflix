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

function lerSalvas(db: Db): Partial<Record<keyof CredenciaisGoogle, string>> {
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

/**
 * Precedência campo a campo: o que a pessoa salvou, depois a env, depois o
 * padrão embutido no build. Por campo (e não tudo-ou-nada) porque quem traz
 * só a própria chave de API ainda aproveita o client OAuth padrão.
 */
export function credenciaisGoogle(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  padrao: CredenciaisGoogle = GOOGLE_PADRAO,
): CredenciaisGoogle {
  const salvas = lerSalvas(db);
  const r = {} as CredenciaisGoogle;
  for (const c of CAMPOS) r[c] = salvas[c] || env[ENV[c]] || padrao[c] || null;
  return r;
}

/** String vazia apaga o campo, devolvendo-o à env ou ao padrão. */
export function salvarCredenciais(db: Db, parcial: Partial<CredenciaisGoogle>): void {
  const atual = lerSalvas(db);
  for (const c of CAMPOS) {
    if (!(c in parcial)) continue;
    const v = parcial[c];
    if (v) atual[c] = v;
    else delete atual[c];
  }
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(CHAVE, JSON.stringify(atual));
}
