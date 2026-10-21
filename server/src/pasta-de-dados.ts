import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db';
import { defaultDataDir, pastaDeDadosAntiga } from './config';

// A pasta de dados era ~/.learnflix (no Windows, %LOCALAPPDATA%\Learnflix), do
// tempo em que o app se chamava Learnflix. Ela é movida inteira, uma vez, para o
// nome novo: copiar dobraria os downloads no disco, e começar vazio perderia o
// banco e a sessão da conta.

/**
 * Antes de abrir o banco. Devolve a pasta antiga quando a mudança aconteceu
 * agora (para `corrigirCaminhos`), ou quando não deu para mover: aí o app segue
 * nela (via DATA_DIR) e tenta de novo na próxima abertura.
 */
export function moverPastaDeDados(): { antiga: string; movida: boolean } | null {
  if (process.env.DATA_DIR) return null;
  const nova = defaultDataDir();
  const antiga = pastaDeDadosAntiga();
  if (fs.existsSync(nova) || !fs.existsSync(antiga)) return null;
  try {
    fs.mkdirSync(path.dirname(nova), { recursive: true });
    fs.renameSync(antiga, nova);
    return { antiga, movida: true };
  } catch {
    // Arquivo preso por outro processo (Windows) ou outro disco: fica onde está.
    process.env.DATA_DIR = antiga;
    return { antiga, movida: false };
  }
}

const trocarPrefixo = (valor: string, antiga: string, nova: string) =>
  valor === antiga || valor.startsWith(antiga + path.sep) ? nova + valor.slice(antiga.length) : null;

/**
 * O banco guarda caminhos absolutos dos downloads (e da pasta de armazenamento,
 * se a pessoa escolheu uma dentro da pasta de dados). Depois de mover, eles
 * passam a apontar para o lugar novo; sem isso, tudo voltaria a aparecer como
 * não baixado.
 */
export function corrigirCaminhos(db: Db, antiga: string, nova: string): void {
  const trocar = (sel: string, upd: string, colunas: string[]) => {
    const linhas = db.prepare(sel).all() as Array<Record<string, string>>;
    const st = db.prepare(upd);
    for (const l of linhas) {
      const novos = colunas.map((c) => trocarPrefixo(l[c], antiga, nova));
      if (novos.every((v) => v === null)) continue;
      st.run(...novos.map((v, i) => v ?? l[colunas[i]]), l.rowid);
    }
  };
  trocar('SELECT rowid, arquivo FROM baixados', 'UPDATE baixados SET arquivo=? WHERE rowid=?', ['arquivo']);
  trocar('SELECT rowid, raiz, pasta FROM pastas_baixadas', 'UPDATE pastas_baixadas SET raiz=?, pasta=? WHERE rowid=?', ['raiz', 'pasta']);
  trocar("SELECT rowid, value FROM settings WHERE key='armazenamento.pasta'", 'UPDATE settings SET value=? WHERE rowid=?', ['value']);
}
