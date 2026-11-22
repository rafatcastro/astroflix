import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O Claude Code da pessoa (`claude`), usado para organizar um curso do Telegram a
// partir de um texto que ela escreve ou cola (routes/mapa.ts). É opcional como o
// ffmpeg e o yt-dlp: sem ele, a opção explica como instalar.

export class FalhaClaude extends Error {
  constructor(
    readonly tipo: 'sem-claude' | 'falhou' | 'demorou' | 'resposta-invalida',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/**
 * O executável. O app aberto pelo Dock não herda o PATH do terminal, e o
 * instalador do Claude Code põe o binário em ~/.local/bin (ou ~/.claude/local, no
 * antigo), fora dos lugares que o desktop.ts acrescenta: procura neles também.
 */
export function acharClaude(env: NodeJS.ProcessEnv = process.env): string | null {
  const casa = os.homedir();
  const pastas = [
    ...(env.PATH ?? '').split(path.delimiter).filter(Boolean),
    path.join(casa, '.local', 'bin'),
    path.join(casa, '.claude', 'local'),
    path.join(casa, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  if (process.platform === 'win32' && env.APPDATA) pastas.push(path.join(env.APPDATA, 'npm'));
  const nomes = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const pasta of pastas) {
    for (const nome of nomes) {
      const arquivo = path.join(pasta, nome);
      try {
        if (fs.statSync(arquivo).isFile()) return arquivo;
      } catch {
        /* não está aqui */
      }
    }
  }
  return null;
}

/**
 * Uma pergunta só, com a resposta validada pelo `schema` (a saída estruturada do
 * `claude -p`). Roda numa pasta vazia, sem ferramentas, sem MCP, sem as
 * configurações e plugins da pessoa: só lê o texto e responde. Com tudo isso
 * carregado, cada pedido levava ~100 mil tokens de contexto que não serviam para nada.
 */
export async function perguntarAoClaude<T>(prompt: string, schema: object, limiteMs = 180_000): Promise<T> {
  const bin = acharClaude();
  if (!bin) throw new FalhaClaude('sem-claude', 'O Claude Code não está instalado.');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'astroflix-claude-'));
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--model', 'sonnet',
    '--json-schema', JSON.stringify(schema),
  ];
  try {
    const saida = await new Promise<string>((resolve, reject) => {
      const p = spawn(bin, args, { cwd: pasta, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && bin.endsWith('.cmd') });
      let out = '';
      let err = '';
      const relogio = setTimeout(() => {
        p.kill();
        reject(new FalhaClaude('demorou', 'O Claude demorou demais para responder.'));
      }, limiteMs);
      p.stdout.on('data', (d: Buffer) => (out += d.toString()));
      p.stderr.on('data', (d: Buffer) => (err += d.toString()));
      p.on('error', (e) => {
        clearTimeout(relogio);
        reject(new FalhaClaude('falhou', e.message));
      });
      p.on('close', (codigo) => {
        clearTimeout(relogio);
        if (codigo === 0) resolve(out);
        // O `-p` com JSON põe o erro (sem login, sem créditos) no próprio resultado.
        else reject(new FalhaClaude('falhou', (lerResultado(out)?.result as string | undefined) || err.trim() || `saiu com código ${codigo}`));
      });
      p.stdin.end(prompt);
    });
    const r = lerResultado(saida);
    if (!r || r.is_error) throw new FalhaClaude('falhou', String(r?.result ?? 'resposta vazia'));
    if (r.structured_output && typeof r.structured_output === 'object') return r.structured_output as T;
    try {
      return JSON.parse(String(r.result)) as T;
    } catch {
      throw new FalhaClaude('resposta-invalida', 'O Claude não devolveu a estrutura pedida.');
    }
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

function lerResultado(saida: string): { is_error?: boolean; result?: unknown; structured_output?: unknown } | null {
  try {
    return JSON.parse(saida.trim());
  } catch {
    return null;
  }
}
