import fs from 'node:fs';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { ClienteTelegram, GrupoTelegram } from '../telegram/cliente';
import { montarCurso, pastasDosTopicos, type CursoTelegram } from '../telegram/mensagens';
import { FalhaTelegram, type PeerTelegram, type TopicoTelegram } from '../telegram/tipos';
import { gravarCapaAtomico, lessonThumbPath } from '../media/thumbs';
import { deriveCourse, type DerivedCourse } from './derive';
import { aplicarReconcile, planReconcile, type ExistingLesson, type ReconcileResult } from './reconcile';
import { inserirCursoDerivado, type ExtraRemoto } from './scan-course';

export interface DepsTelegram {
  cliente: ClienteTelegram;
  config: AppConfig;
}

const CAPAS_SIMULTANEAS = 3;

// O deriveCourse ordena pelo relPath (que começa pelo id da mensagem, então dá
// a ordem de postagem) e tira o título do nome do arquivo. No Telegram o
// título bom está na legenda: troca aqui, pelo relPath, que é a identidade.
// Num grupo com tópicos, os módulos seguem a ordem em que o Telegram mostra os
// tópicos (fixados primeiro, depois a atividade mais recente), e não a
// alfabética do deriveCourse; cada re-escaneio a atualiza.
function derivar(curso: CursoTelegram, topicos: TopicoTelegram[] = []): DerivedCourse {
  const derived = deriveCourse(curso.videos);
  const titulos = new Map(curso.videos.map((v) => [v.relPath, v.titulo]));
  for (const l of derived.lessons) l.title = titulos.get(l.relPath) ?? l.title;
  if (topicos.length && derived.structure === 'modules') {
    const ordem = new Map([...pastasDosTopicos(topicos).values()].map((nome, i) => [nome, i]));
    const posicao = (m: string | null) => (m === null ? -1 : (ordem.get(m) ?? ordem.size));
    // sort estável: dentro do módulo, fica a ordem de postagem que o deriveCourse deu.
    derived.lessons.sort((a, b) => posicao(a.module) - posicao(b.module));
    const modulos = [...new Set(derived.lessons.map((l) => l.module))];
    derived.lessons.forEach((l, i) => {
      l.orderIndex = i;
      l.moduleOrder = modulos.indexOf(l.module);
    });
  }
  return derived;
}

function extrasDe(curso: CursoTelegram): Map<string, ExtraRemoto> {
  const extras = new Map<string, ExtraRemoto>();
  for (const f of [...curso.videos, ...curso.materials]) extras.set(f.relPath, { remoteId: f.remoteId, durationSec: f.durationSec });
  return extras;
}

export function peerDoCurso(db: Db, courseId: string): PeerTelegram | null {
  const row = db.prepare('SELECT telegram_peer FROM courses WHERE id=?').get(courseId) as { telegram_peer: string | null } | undefined;
  if (!row?.telegram_peer) return null;
  try {
    return JSON.parse(row.telegram_peer) as PeerTelegram;
  } catch {
    return null;
  }
}

// Grupo já adicionado não vira curso duplicado: reconcilia o existente e o
// desarquiva, como o Drive faz com a mesma pasta.
export async function createCourseFromTelegram(
  db: Db,
  deps: DepsTelegram,
  grupo: GrupoTelegram,
  linkOriginal: string,
): Promise<{ id: string; existente: boolean }> {
  const ja = db
    .prepare("SELECT id, archived FROM courses WHERE source='telegram' AND json_extract(telegram_peer, '$.id')=? AND IFNULL(json_extract(telegram_peer, '$.topico'), 0)=?")
    .get(grupo.peer.id, grupo.peer.topico ?? 0) as { id: string; archived: number } | undefined;
  if (ja) {
    if (ja.archived) db.prepare('UPDATE courses SET archived=0 WHERE id=?').run(ja.id);
    await reconcileTelegramCourse(db, deps, ja.id);
    return { id: ja.id, existente: true };
  }

  const topicos = await deps.cliente.topicos(grupo.peer);
  const curso = montarCurso(await deps.cliente.mensagens(grupo.peer), topicos);
  if (!curso.videos.length) throw new FalhaTelegram('sem-videos');

  const id = inserirCursoDerivado(
    db,
    { title: grupo.titulo || 'Curso do Telegram', rootPath: linkOriginal, source: 'telegram', telegramPeer: JSON.stringify(grupo.peer) },
    derivar(curso, topicos),
    curso.materials,
    extrasDe(curso),
  );
  // Sem await: o curso já é utilizável e capa é enfeite (mesma regra do Drive).
  dispararCapas(db, deps, id, grupo.peer, curso);
  return { id, existente: false };
}

// O histórico é relido inteiro (e não só o que é novo) para que uma mensagem
// apagada do grupo marque a aula como sumida em vez de deixá-la quebrada.
export async function reconcileTelegramCourse(db: Db, deps: DepsTelegram, courseId: string): Promise<ReconcileResult> {
  const peer = peerDoCurso(db, courseId);
  const course = db.prepare('SELECT root_path, structure FROM courses WHERE id=?').get(courseId) as
    | { root_path: string; structure: string }
    | undefined;
  if (!peer || !course) throw new Error('curso-sem-grupo-do-telegram');

  const topicos = await deps.cliente.topicos(peer);
  const curso = montarCurso(await deps.cliente.mensagens(peer), topicos);
  const derived = derivar(curso, topicos);
  const existing = db
    .prepare('SELECT id, rel_path, mtime, order_index FROM lessons WHERE course_id=?')
    .all(courseId) as unknown as ExistingLesson[];
  const plan = planReconcile(existing, derived.lessons, derived.structure);
  const resultado = aplicarReconcile(db, courseId, plan, curso.materials, course.root_path, extrasDe(curso));
  dispararCapas(db, deps, courseId, peer, curso);
  return resultado;
}

const capasEmAndamento = new Set<Promise<void>>();

export async function aguardarCapasTelegram(): Promise<void> {
  while (capasEmAndamento.size) await Promise.all([...capasEmAndamento]);
}

function dispararCapas(db: Db, deps: DepsTelegram, courseId: string, peer: PeerTelegram, curso: CursoTelegram): void {
  const comMiniatura = new Set(curso.videos.filter((v) => v.temMiniatura).map((v) => v.relPath));
  const p = baixarCapas(db, deps, courseId, peer, comMiniatura).catch(() => {});
  capasEmAndamento.add(p);
  void p.finally(() => capasEmAndamento.delete(p));
}

async function baixarCapas(db: Db, deps: DepsTelegram, courseId: string, peer: PeerTelegram, comMiniatura: Set<string>): Promise<void> {
  const aulas = (
    db.prepare('SELECT id, rel_path, mtime, remote_id, thumb_path FROM lessons WHERE course_id=? AND missing=0').all(courseId) as Array<{
      id: string;
      rel_path: string;
      mtime: number;
      remote_id: string | null;
      thumb_path: string | null;
    }>
  ).filter((a) => a.remote_id && comMiniatura.has(a.rel_path) && !(a.thumb_path && fs.existsSync(a.thumb_path)));
  const gravar = db.prepare('UPDATE lessons SET thumb_path=? WHERE id=?');

  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < aulas.length) {
      const aula = aulas[proxima++];
      try {
        const bytes = await deps.cliente.miniatura(peer, Number(aula.remote_id));
        if (!bytes) continue;
        const destino = lessonThumbPath(deps.config, aula.id, aula.mtime);
        gravarCapaAtomico(destino, bytes);
        gravar.run(destino, aula.id);
      } catch {
        // Capa que falha (rede, mensagem apagada) vira placeholder; não bloqueia o curso.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CAPAS_SIMULTANEAS, aulas.length) }, trabalhador));
}
