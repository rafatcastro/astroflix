import path from 'node:path';

// Modo desktop: o servidor roda como sidecar do app Tauri (ver desktop/).

/**
 * Linha de máquina com a URL real. O app desktop lê a saída do sidecar até
 * achar esta linha — a porta pode não ser a 7777 (ver listen.ts), então a URL
 * não pode ser adivinhada do lado de lá.
 */
export function linhaDaUrl(url: string): string {
  return `LEARNFLIX_URL=${url}`;
}

/**
 * Um app aberto pelo Dock ou pelo menu Iniciar não herda o PATH do terminal:
 * no macOS ele vem só com /usr/bin:/bin, e o ffmpeg do Homebrew some — junto
 * com capas e duração. Acrescenta os lugares onde ele costuma estar, só os que
 * existem e sem duplicar. Puro: a sonda de existência é injetada.
 */
export function pathComExtras(
  atual: string,
  plataforma: NodeJS.Platform,
  existe: (dir: string) => boolean,
  env: NodeJS.ProcessEnv,
): string {
  const sep = plataforma === 'win32' ? ';' : ':';
  const candidatos: string[] = [];
  if (plataforma === 'darwin') candidatos.push('/opt/homebrew/bin', '/usr/local/bin');
  else if (plataforma === 'linux') candidatos.push('/usr/local/bin', '/usr/bin');
  else if (plataforma === 'win32') {
    if (env.ProgramFiles) candidatos.push(path.win32.join(env.ProgramFiles, 'ffmpeg', 'bin'));
    if (env.LOCALAPPDATA) candidatos.push(path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  }
  const partes = atual.split(sep).filter(Boolean);
  for (const dir of candidatos) {
    if (!partes.includes(dir) && existe(dir)) partes.push(dir);
  }
  return partes.join(sep);
}
