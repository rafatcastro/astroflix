import fs from 'node:fs';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { ClienteDrive } from '../drive/api';
import type { Fetch, LinkDrive } from '../drive/tipos';
import { walkDrive } from '../drive/walk';
import { lessonThumbPath } from '../media/thumbs';
import { deriveCourse } from './derive';
import { aplicarReconcile, planReconcile, type ExistingLesson, type ReconcileResult } from './reconcile';
import { inserirCursoDerivado, type ExtraRemoto } from './scan-course';

export interface DepsIngestao {
  cliente: ClienteDrive;
  fetch: Fetch;
  config: AppConfig;
  token: () => Promise<string | null>;
}

const CAPAS_SIMULTANEAS = 4;

// Pasta já adicionada não vira curso duplicado: reconcilia o existente (como o
// POST /api/courses faz com o caminho local) e o desarquiva se preciso.
export async function createCourseFromDrive(
  db: Db,
  deps: DepsIngestao,
  link: LinkDrive,
  linkOriginal: string,
): Promise<{ id: string; existente: boolean }> {
  const ja = db.prepare('SELECT id, archived FROM courses WHERE drive_folder_id=?').get(link.folderId) as
    | { id: string; archived: number }
    | undefined;
  if (ja) {
    if (ja.archived) db.prepare('UPDATE courses SET archived=0 WHERE id=?').run(ja.id);
    await reconcileDriveCourse(db, deps, ja.id);
    return { id: ja.id, existente: true };
  }

  const { titulo, videos, materials } = await walkDrive(deps.cliente, link.folderId);
  const derived = deriveCourse(videos);

  const extras = new Map<string, ExtraRemoto>();
  const capas = new Map<string, string>();
  for (const f of [...videos, ...materials]) {
    extras.set(f.relPath, { remoteId: f.remoteId, durationSec: f.durationSec });
  }
  for (const v of videos) if (v.thumbnailLink) capas.set(v.relPath, v.thumbnailLink);

  const id = inserirCursoDerivado(
    db,
    {
      title: titulo,
      rootPath: linkOriginal,
      source: 'drive',
      driveFolderId: link.folderId,
      driveResourceKey: link.resourceKey,
    },
    derived,
    materials,
    extras,
  );

  // Fora da transação e SEM await: o curso já existe e é utilizável, e capa é
  // enfeite. Esperar o download (uma ida ao Google por aula) deixava o
  // "Lendo a pasta…" por minutos em cursos grandes; as que faltarem na estante
  // são buscadas sob demanda pela rota de thumb.
  dispararCapas(db, deps, id, capas);
  return { id, existente: false };
}

// Guarda as promessas em andamento só para os testes poderem esperar o fim
// (aguardarCapas); em produção ninguém espera por elas.
const capasEmAndamento = new Set<Promise<void>>();

function dispararCapas(db: Db, deps: DepsIngestao, courseId: string, capas: Map<string, string>): void {
  const p = baixarCapasFaltando(db, deps, courseId, capas).catch(() => {});
  capasEmAndamento.add(p);
  void p.finally(() => capasEmAndamento.delete(p));
}

export async function aguardarCapas(): Promise<void> {
  while (capasEmAndamento.size) await Promise.all([...capasEmAndamento]);
}

// Baixa uma imagem de capa; null em qualquer falha. Compartilhada com a capa
// sob demanda (media/thumbs.ts) para a regra do Bearer existir num lugar só.
export async function baixarImagemDoGoogle(
  deps: Pick<DepsIngestao, 'fetch' | 'token'>,
  url: string,
): Promise<Buffer | null> {
  try {
    // O thumbnailLink vem de um campo que o dono da pasta controla: o token só
    // pode ir para hosts do Google, nunca para um endereço arbitrário.
    const token = hostDoGoogle(url) ? await deps.token() : null;
    const res = await deps.fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function hostDoGoogle(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname.endsWith('.googleusercontent.com') || u.hostname.endsWith('.google.com'));
  } catch {
    return false;
  }
}

export async function baixarCapasFaltando(
  db: Db,
  deps: DepsIngestao,
  courseId: string,
  capas: Map<string, string>,
): Promise<void> {
  const aulas = db
    .prepare('SELECT id, rel_path, mtime FROM lessons WHERE course_id=?')
    .all(courseId) as Array<{ id: string; rel_path: string; mtime: number }>;
  const fila = aulas.filter((a) => capas.has(a.rel_path));
  const gravar = db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?');

  async function baixarUma(aula: { id: string; rel_path: string; mtime: number }): Promise<void> {
    try {
      const bytes = await baixarImagemDoGoogle(deps, capas.get(aula.rel_path)!);
      if (!bytes) return;
      const destino = lessonThumbPath(deps.config, aula.id, aula.mtime);
      fs.mkdirSync(deps.config.thumbsDir, { recursive: true });
      fs.writeFileSync(destino, bytes);
      gravar.run(destino, aula.id);
    } catch {
      // Uma capa que falha (link expirado, rede, disco) não pode bloquear o
      // curso: a interface já mostra o placeholder quando thumb_path é null.
    }
  }

  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < fila.length) await baixarUma(fila[proxima++]);
  };
  await Promise.all(Array.from({ length: Math.min(CAPAS_SIMULTANEAS, fila.length) }, trabalhador));
}

// Mesmo plano do curso local, com a listagem vinda do Drive. O progresso segue
// preso ao relPath: um arquivo re-enviado com o mesmo nome ganha outro
// remote_id, mas continua sendo a mesma aula.
export async function reconcileDriveCourse(
  db: Db,
  deps: DepsIngestao,
  courseId: string,
): Promise<ReconcileResult> {
  const course = db
    .prepare('SELECT root_path, structure, drive_folder_id FROM courses WHERE id=?')
    .get(courseId) as { root_path: string; structure: string; drive_folder_id: string | null } | undefined;
  if (!course?.drive_folder_id) throw new Error('curso-sem-pasta-do-drive');

  const { videos, materials } = await walkDrive(deps.cliente, course.drive_folder_id);
  const derived = deriveCourse(videos);
  const existing = db
    .prepare('SELECT id, rel_path, mtime, order_index FROM lessons WHERE course_id=?')
    .all(courseId) as unknown as ExistingLesson[];
  const plan = planReconcile(existing, derived.lessons, derived.structure);

  const extras = new Map<string, ExtraRemoto>();
  const capas = new Map<string, string>();
  for (const f of [...videos, ...materials]) {
    extras.set(f.relPath, { remoteId: f.remoteId, durationSec: f.durationSec });
  }
  for (const v of videos) if (v.thumbnailLink) capas.set(v.relPath, v.thumbnailLink);

  const resultado = aplicarReconcile(db, courseId, plan, materials, course.root_path, extras);

  // Só o que ainda não tem capa em disco: o arquivo re-enviado teve thumb_path
  // zerado pelo mtime novo, e as demais aulas não precisam baixar tudo de novo.
  const comCapa = new Set(
    (db.prepare('SELECT rel_path, thumb_path FROM lessons WHERE course_id=?').all(courseId) as Array<{
      rel_path: string;
      thumb_path: string | null;
    }>)
      .filter((a) => a.thumb_path && fs.existsSync(a.thumb_path))
      .map((a) => a.rel_path),
  );
  for (const rel of comCapa) capas.delete(rel);
  dispararCapas(db, deps, courseId, capas);
  return resultado;
}
