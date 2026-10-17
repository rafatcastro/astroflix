import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// A pasta Downloads do usuário, onde o "Baixar" do curso salva. No Windows e no
// Linux a pessoa pode tê-la movido (outro disco, OneDrive, idioma do sistema):
// pergunta ao sistema e só cai no ~/Downloads se ele não responder.

const perguntar = (cmd: string, args: string[]): string | null => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim() || null;
  } catch {
    return null;
  }
};

// O GUID é o da pasta Downloads (FOLDERID_Downloads); o valor pode vir com
// %USERPROFILE% ainda por expandir.
const doRegistro = (): string | null => {
  const saida = perguntar('reg', [
    'query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    '/v',
    '{374DE290-123F-4565-9164-39C4925E467B}',
  ]);
  const valor = saida?.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/m)?.[1]?.trim();
  return valor ? valor.replace(/%([^%]+)%/g, (t, nome: string) => process.env[nome] ?? t) : null;
};

export function pastaDeDownloads(): string {
  const padrao = path.join(os.homedir(), 'Downloads');
  if (process.platform === 'win32') return doRegistro() ?? padrao;
  if (process.platform === 'linux') {
    const xdg = perguntar('xdg-user-dir', ['DOWNLOAD']);
    // Sem a pasta configurada, o xdg-user-dir responde a própria home.
    return xdg && xdg !== os.homedir() ? xdg : padrao;
  }
  return padrao;
}
