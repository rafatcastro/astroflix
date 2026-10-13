import fs from 'node:fs';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { ClienteDrive } from '../drive/api';
import type { Fetch, LinkDrive } from '../drive/tipos';
import { walkDrive, type ArquivoRemoto, type WalkDriveResult } from '../drive/walk';
import { FalhaDrive } from '../drive/tipos';
import { gravarCapaAtomico, lessonThumbPath } from '../media/thumbs';
import { deriveCourse } from './derive';
import { aplicarReconcile, planReconcile, type ExistingLesson, type ReconcileResult } from './reconcile';
import { inserirCursoDerivado, type ExtraRemoto } from './scan-course';

export interface DepsIngestao {
  cliente: ClienteDrive;
  fetch: Fetch;
  config: AppConfig;
  token: () => Promise<string | null>;
  /** Chamado quando a pasta do curso terminou de ser lida (para baixar as aulas). */
  depoisDeLer?: (courseId: string) => void;
}

const CAPAS_SIMULTANEAS = 4;

// Pasta já adicionada não vira curso duplicado: reconcilia o existente (como o
// POST /api/courses faz com o caminho local) e o desarquiva se preciso.
//
// Volta assim que a pasta raiz responde (é ali que aparecem "privada", "não é
// pasta" e "sem login", que o modal precisa mostrar). A listagem inteira, uma ida
// ao Google por pasta, corre em segundo plano: antes o "Lendo a pasta…" prendia o
// modal por minutos em cursos grandes. As aulas vão entrando no curso enquanto a
// pasta é lida, e o estado fica em `importacaoDrive(id)`.
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
    emSegundoPlano(ja.id, () => reconcileDriveCourse(db, deps, ja.id).then(() => {}));
    return { id: ja.id, existente: true };
  }

  const raiz = await deps.cliente.getArquivo(link.folderId);
  if (raiz.mimeType !== 'application/vnd.google-apps.folder') throw new FalhaDrive('nao-e-pasta');

  const id = inserirCursoDerivado(
    db,
    {
      title: raiz.name,
      rootPath: linkOriginal,
      source: 'drive',
      driveFolderId: link.folderId,
      driveResourceKey: link.resourceKey,
    },
    deriveCourse([]),
    [],
  );
  emSegundoPlano(id, () => lerCursoNovo(db, deps, id, link.folderId));
  return { id, existente: false };
}

// Grava o que já foi lido a cada pasta, no máximo uma vez por intervalo: num
// curso com centenas de pastas, regravar a cada uma seria trabalho à toa. Num
// curso novo isso é seguro, porque não há progresso que uma aula "ainda não
// vista" pudesse perder.
const GRAVAR_A_CADA_MS = 800;

async function lerCursoNovo(db: Db, deps: DepsIngestao, id: string, pastaId: string): Promise<void> {
  const root = (db.prepare('SELECT root_path FROM courses WHERE id=?').get(id) as { root_path: string }).root_path;
  let ultima = 0;
  const gravar = (videos: ArquivoRemoto[], materials: WalkDriveResult['materials']) => {
    if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(id)) return; // excluído no meio
    const derived = deriveCourse(videos);
    const existing = db
      .prepare('SELECT id, rel_path, mtime, order_index FROM lessons WHERE course_id=?')
      .all(id) as unknown as ExistingLesson[];
    const extras = new Map<string, ExtraRemoto>();
    for (const f of [...videos, ...materials]) extras.set(f.relPath, { remoteId: f.remoteId, durationSec: f.durationSec });
    aplicarReconcile(db, id, planReconcile(existing, derived.lessons, derived.structure), materials, root, extras);
  };

  const { videos, materials } = await walkDrive(deps.cliente, pastaId, (parcial) => {
    if (Date.now() - ultima < GRAVAR_A_CADA_MS) return;
    ultima = Date.now();
    gravar(parcial.videos, parcial.materials);
  });
  gravar(videos, materials);

  const capas = new Map<string, string>();
  for (const v of videos) if (v.thumbnailLink) capas.set(v.relPath, v.thumbnailLink);
  dispararCapas(db, deps, id, capas);
  deps.depoisDeLer?.(id);
}

// Estado das leituras em segundo plano, por curso. Só em memória: se o app
// fechar no meio, o curso fica com o que já foi gravado e "Re-escanear" termina.
const importacoes = new Map<string, { promessa: Promise<void> | null; erro: string | null }>();

function emSegundoPlano(id: string, tarefa: () => Promise<void>): void {
  if (importacoes.get(id)?.promessa) return; // já está lendo: colar de novo não dispara outra
  const estado = { promessa: null as Promise<void> | null, erro: null as string | null };
  estado.promessa = tarefa()
    .catch((e) => {
      estado.erro = e instanceof FalhaDrive ? e.tipo : 'sem-conexao';
    })
    .finally(() => {
      estado.promessa = null;
    });
  importacoes.set(id, estado);
}

/** Se a pasta do curso ainda está sendo lida, e o erro da última leitura, se houve. */
export function importacaoDrive(id: string): { carregando: boolean; erro: string | null } {
  const e = importacoes.get(id);
  return { carregando: !!e?.promessa, erro: e?.erro ?? null };
}

// Guarda as promessas em andamento só para os testes poderem esperar o fim
// (aguardarCapas); em produção ninguém espera por elas.
const capasEmAndamento = new Set<Promise<void>>();

function dispararCapas(db: Db, deps: DepsIngestao, courseId: string, capas: Map<string, string>): void {
  const p = baixarCapasFaltando(db, deps, courseId, capas).catch(() => {});
  capasEmAndamento.add(p);
  void p.finally(() => capasEmAndamento.delete(p));
}

/** Para os testes: espera as leituras em segundo plano e as capas terminarem. */
export async function aguardarCapas(): Promise<void> {
  for (;;) {
    const pendentes = [...capasEmAndamento, ...[...importacoes.values()].map((e) => e.promessa).filter((p): p is Promise<void> => !!p)];
    if (!pendentes.length) return;
    await Promise.all(pendentes);
  }
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
      gravarCapaAtomico(destino, bytes);
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
  deps.depoisDeLer?.(courseId);
  return resultado;
}
