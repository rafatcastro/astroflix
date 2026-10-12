import type { Db } from '../db';
import type { ClienteDrive } from './api';
import type { ServicosDrive } from './servicos';

// Só para testes: um curso do Drive com uma aula e um material, sem passar
// pelo scan (que exigiria um fetch falso da listagem inteira).
export function semearCursoDrive(db: Db, resourceKey: string | null = null) {
  db.prepare(
    `INSERT INTO courses (id, title, root_path, structure, created_at, updated_at, source, drive_folder_id, drive_resource_key)
     VALUES ('cd', 'Curso Drive', 'drive:pasta1', 'flat', 'x', 'x', 'drive', 'pasta1', ?)`,
  ).run(resourceKey);
  db.prepare(
    `INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, remote_id)
     VALUES ('ld', 'cd', 'aula.mp4', 'Aula', 0, 0, 10, 1, 'mp4', 1, 'arq-video')`,
  ).run();
  db.prepare(
    `INSERT INTO materials (id, course_id, rel_path, kind, size_bytes, remote_id)
     VALUES ('md', 'cd', 'apostila.pdf', 'pdf', 10, 'arq-pdf')`,
  ).run();
}

export function servicosFalsos(baixar: ClienteDrive['baixar'], chaves?: (rk?: string | null) => void, conectado = true): ServicosDrive {
  return {
    auth: { status: () => ({ conectado, email: null }) },
    cliente: (rk?: string | null) => {
      chaves?.(rk);
      return { baixar } as unknown as ClienteDrive;
    },
  } as unknown as ServicosDrive;
}
