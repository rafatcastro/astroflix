import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db';
import type { AppConfig } from './config';
import { destinoDe, registrarBaixado, type ItemBaixavel } from './armazenamento';

// O cache automático das aulas do Drive e do Telegram: abrir uma aula traz ela e
// as próximas para cá, e elas abrem sem esperar a rede. É do app, não da pessoa:
// fica em DATA_DIR/cache com o id da aula no nome e tem limite. Quando passa
// dele, o app apaga sozinho, primeiro as concluídas e depois as usadas há mais
// tempo. É a exceção declarada ao "nada é apagado sozinho", que continua valendo
// para o "Baixar" (armazenamento.ts): o que a pessoa mandou baixar é dela.
//
// Antes, a janela automática gravava direto na pasta de armazenamento, como se a
// pessoa tivesse clicado em "Baixar", e o disco enchia de aulas que ninguém pediu.

const CHAVE_LIMITE = 'cache.limite';
export const LIMITE_PADRAO = 10 * 1024 ** 3;
export const LIMITE_MIN = 2 * 1024 ** 3;
export const LIMITE_MAX = 100 * 1024 ** 3;

const dentro = (arquivo: string, raiz: string) => {
  const rel = path.relative(raiz, arquivo);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

export function caminhoNoCache(config: AppConfig, lessonId: string, ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return path.join(config.cacheDir, `${lessonId}.${e}`);
}

/** O arquivo desta aula no cache; a linha cujo arquivo sumiu é esquecida. */
export function arquivoEmCache(db: Db, lessonId: string): { arquivo: string; convertido: boolean } | null {
  const r = db.prepare('SELECT arquivo, convertido FROM cache_aulas WHERE lesson_id=?').get(lessonId) as
    | { arquivo: string; convertido: number }
    | undefined;
  if (!r) return null;
  if (!fs.existsSync(r.arquivo)) {
    esquecer(db, lessonId, !!r.convertido);
    return null;
  }
  return { arquivo: r.arquivo, convertido: !!r.convertido };
}

export function registrarEmCache(db: Db, lessonId: string, arquivo: string, convertido: boolean): void {
  const bytes = fs.statSync(arquivo).size;
  db.prepare(
    `INSERT INTO cache_aulas (lesson_id, arquivo, bytes, convertido, usado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET arquivo=excluded.arquivo, bytes=excluded.bytes, convertido=excluded.convertido, usado_em=excluded.usado_em`,
  ).run(lessonId, arquivo, bytes, convertido ? 1 : 0, Date.now());
  // Agora há arquivo local: a capa que tinha falhado pode sair dele.
  db.prepare('DELETE FROM capas_estado WHERE lesson_id=?').run(lessonId);
}

export function tocarCache(db: Db, lessonId: string): void {
  db.prepare('UPDATE cache_aulas SET usado_em=? WHERE lesson_id=?').run(Date.now(), lessonId);
}

export function limiteDoCache(db: Db): number {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE_LIMITE) as { value: string } | undefined;
  const n = Number(r?.value);
  return Number.isFinite(n) && n >= LIMITE_MIN && n <= LIMITE_MAX ? n : LIMITE_PADRAO;
}

/** false = fora do intervalo, nada gravado. */
export function definirLimiteDoCache(db: Db, bytes: number): boolean {
  if (!Number.isFinite(bytes) || bytes < LIMITE_MIN || bytes > LIMITE_MAX) return false;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    CHAVE_LIMITE,
    String(Math.round(bytes)),
  );
  return true;
}

export function usoDoCache(db: Db): { bytes: number; limite: number } {
  const r = db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM cache_aulas').get() as { n: number };
  return { bytes: Number(r.n), limite: limiteDoCache(db) };
}

// Só a cópia convertida tocava: sem ela, a aula volta a dizer que não toca (e é
// convertida de novo quando voltar ao cache), em vez de abrir um player quebrado.
function esquecer(db: Db, lessonId: string, convertido: boolean): void {
  db.prepare('DELETE FROM cache_aulas WHERE lesson_id=?').run(lessonId);
  if (convertido && !db.prepare("SELECT 1 FROM baixados WHERE tipo='aula' AND item_id=?").get(lessonId))
    db.prepare('UPDATE lessons SET playable=0 WHERE id=?').run(lessonId);
}

function apagarLinha(db: Db, lessonId: string, arquivo: string, convertido = false): void {
  fs.rmSync(arquivo, { force: true });
  esquecer(db, lessonId, convertido);
}

/**
 * Apaga até caber no limite: as concluídas primeiro (a pessoa já viu), depois as
 * usadas há mais tempo. As protegidas (a aula aberta e as próximas) nunca saem,
 * mesmo que o cache fique acima do limite. Devolve os bytes liberados.
 */
export function liberarCache(db: Db, protegidas: Set<string>): number {
  let { bytes, limite } = usoDoCache(db);
  if (bytes <= limite) return 0;
  const linhas = db
    .prepare(
      `SELECT c.lesson_id, c.arquivo, c.bytes, c.convertido FROM cache_aulas c LEFT JOIN progress p ON p.lesson_id = c.lesson_id
       ORDER BY COALESCE(p.completed, 0) DESC, c.usado_em ASC`,
    )
    .all() as Array<{ lesson_id: string; arquivo: string; bytes: number; convertido: number }>;
  let liberados = 0;
  for (const l of linhas) {
    if (bytes <= limite) break;
    if (protegidas.has(l.lesson_id)) continue;
    apagarLinha(db, l.lesson_id, l.arquivo, !!l.convertido);
    bytes -= Number(l.bytes);
    liberados += Number(l.bytes);
  }
  return liberados;
}

/**
 * "Baixar" de uma aula que já está no cache: o arquivo vai para a pasta de
 * armazenamento com o nome real, sem baixar de novo. Devolve o caminho final, ou
 * null (não estava no cache, ou a mudança falhou e o download segue da origem).
 */
export function promoverDoCache(db: Db, config: AppConfig, item: ItemBaixavel): string | null {
  if (item.tipo !== 'aula') return null;
  const c = arquivoEmCache(db, item.id);
  if (!c) return null;
  try {
    let destino = destinoDe(db, config, item);
    // Convertido no cache: o arquivo é .mp4, e o nome real ganha a extensão certa.
    if (c.convertido) destino = destino.slice(0, destino.length - path.extname(destino).length) + '.mp4';
    if (fs.existsSync(destino)) return null;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    try {
      fs.renameSync(c.arquivo, destino);
    } catch (e) {
      // A pasta de armazenamento num disco externo: rename não cruza discos.
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
      fs.copyFileSync(c.arquivo, destino);
      fs.rmSync(c.arquivo, { force: true });
    }
    registrarBaixado(db, item, destino, c.convertido);
    db.prepare('DELETE FROM cache_aulas WHERE lesson_id=?').run(item.id);
    return destino;
  } catch {
    return null;
  }
}

export function apagarCacheDoCurso(db: Db, courseId: string): void {
  const linhas = db
    .prepare('SELECT c.lesson_id, c.arquivo FROM cache_aulas c JOIN lessons l ON l.id = c.lesson_id WHERE l.course_id=?')
    .all(courseId) as Array<{ lesson_id: string; arquivo: string }>;
  // O curso vai ser excluído: playable não importa mais.
  for (const l of linhas) apagarLinha(db, l.lesson_id, l.arquivo);
}

/** "Limpar cache" das Configurações. O baixador para o arquivo de cache em andamento antes (pararCache). */
export function limparCache(db: Db, config: AppConfig): void {
  const linhas = db.prepare('SELECT lesson_id, arquivo, convertido FROM cache_aulas').all() as Array<{
    lesson_id: string;
    arquivo: string;
    convertido: number;
  }>;
  for (const l of linhas) apagarLinha(db, l.lesson_id, l.arquivo, !!l.convertido);
  try {
    for (const f of fs.readdirSync(config.cacheDir)) fs.rmSync(path.join(config.cacheDir, f), { force: true, recursive: true });
  } catch {
    /* a pasta ainda não existe */
  }
}

/**
 * Uma vez ao abrir: tira o que sobrou sem dono. Cobre o curso apagado pela
 * sincronização e a troca de conta (a cascata leva as linhas, não os arquivos) e
 * o `.part` de uma aula que já não está na janela. O `.part` da janela fica, para
 * o download continuar dele.
 */
export function varrerCache(db: Db, config: AppConfig, janela: Set<string>): void {
  const linhas = db.prepare('SELECT lesson_id, arquivo FROM cache_aulas').all() as Array<{ lesson_id: string; arquivo: string }>;
  const conhecidos = new Set<string>();
  for (const l of linhas) if (arquivoEmCache(db, l.lesson_id)) conhecidos.add(path.resolve(l.arquivo));
  let nomes: string[];
  try {
    nomes = fs.readdirSync(config.cacheDir);
  } catch {
    return;
  }
  for (const nome of nomes) {
    const arquivo = path.join(config.cacheDir, nome);
    if (!dentro(arquivo, config.cacheDir)) continue;
    if (nome.endsWith('.part')) {
      const id = nome.split('.')[0];
      if (!janela.has(id)) fs.rmSync(arquivo, { force: true });
      continue;
    }
    if (!conhecidos.has(path.resolve(arquivo))) fs.rmSync(arquivo, { force: true, recursive: true });
  }
}
