import fs from 'node:fs';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { ClienteDrive } from '../drive/api';
import type { Fetch, LinkDrive } from '../drive/tipos';
import { walkDrive } from '../drive/walk';
import { lessonThumbPath } from '../media/thumbs';
import { deriveCourse } from './derive';
import { inserirCursoDerivado, type ExtraRemoto } from './scan-course';

export interface DepsIngestao {
  cliente: ClienteDrive;
  fetch: Fetch;
  config: AppConfig;
  token: () => Promise<string | null>;
}

const CAPAS_SIMULTANEAS = 4;

// Sempre cria um curso novo. Reconhecer uma pasta já adicionada fica com a
// reconciliação (Tarefa 7); aqui `existente` é sempre false.
export async function createCourseFromDrive(
  db: Db,
  deps: DepsIngestao,
  link: LinkDrive,
  linkOriginal: string,
): Promise<{ id: string; existente: boolean }> {
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

  // Fora da transação e sem await no chamador crítico: o curso já existe e é
  // utilizável; capa é enfeite e não pode atrasar nem derrubar a criação.
  await baixarCapasFaltando(db, deps, id, capas);
  return { id, existente: false };
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
      const token = await deps.token();
      const res = await deps.fetch(capas.get(aula.rel_path)!, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const destino = lessonThumbPath(deps.config, aula.id, aula.mtime);
      fs.mkdirSync(deps.config.thumbsDir, { recursive: true });
      fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
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
