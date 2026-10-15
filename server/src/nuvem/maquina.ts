import { randomUUID } from 'node:crypto';
import type { Db } from '../db';

// Um id por computador: a nuvem sabe onde fica a pasta de cada curso local nele, e
// o tempo de aula de cada máquina fica numa linha própria (ver db v10).
export function maquinaId(db: Db): string {
  const r = db.prepare("SELECT valor FROM nuvem_estado WHERE chave='maquina'").get() as { valor: string | null } | undefined;
  if (r?.valor) return r.valor;
  const id = randomUUID();
  db.prepare("INSERT INTO nuvem_estado (chave, valor) VALUES ('maquina', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor").run(id);
  return id;
}
