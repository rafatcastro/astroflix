import type { Db } from '../db';
import type { ServicosDrive } from './servicos';
import { resourceKeyDoCurso } from './status';
import { baixarImagemDoGoogle } from '../scan/scan-drive';

// A capa da aula do Drive vem do próprio Drive, na hora, sem gravar nada nesta
// máquina: antes ela entrava na fila de capas e, sem miniatura, o ffmpeg lia um
// pedaço do vídeo pela rede, o que baixava dados e demorava a aparecer. A janela
// guarda a imagem no cache HTTP dela (Cache-Control), então rolar de volta não pede de novo.
//
// O thumbnailLink expira em algumas horas e a imagem exige o token (pasta privada): o
// servidor repassa os bytes. O link fica em memória por 1 h, para cada capa custar uma
// ida ao Drive e não duas.

const VALIDADE_DO_LINK = 60 * 60_000;
/** Esperar mais que isso prenderia as poucas conexões que a janela abre com o servidor. */
const LIMITE_MS = 8_000;

const links = new Map<string, { link: string | null; em: number }>();

/** O link que a listagem do Drive acabou de trazer (o import), para a primeira capa não pedir o arquivo de novo. */
export function guardarLinkDeCapa(lessonId: string, link: string): void {
  links.set(lessonId, { link, em: Date.now() });
}

export type CapaDoDrive = { bytes: Buffer } | 'sem-capa' | 'rede';

function comTempo<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), LIMITE_MS))]);
}

// A miniatura padrão do Drive tem 220 px; a lista e o "Continuar" mostram maior.
const maior = (link: string) => (/=s\d+$/.test(link) ? link.replace(/=s\d+$/, '=w480') : link);

/** null = a aula não é do Drive (segue o caminho das capas locais). */
export async function capaDoDrive(db: Db, drive: ServicosDrive | undefined, lessonId: string): Promise<CapaDoDrive | null> {
  const row = db
    .prepare(
      `SELECT l.remote_id, c.source, c.drive_folder_id, c.drive_resource_key
         FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`,
    )
    .get(lessonId) as { remote_id: string | null; source: string; drive_folder_id: string | null; drive_resource_key: string | null } | undefined;
  if (!row || row.source !== 'drive') return null;
  if (!drive || !row.remote_id) return 'sem-capa';
  const ing = drive.ingestao(resourceKeyDoCurso(row.drive_folder_id, row.drive_resource_key));
  try {
    let guardado = links.get(lessonId);
    if (!guardado || Date.now() - guardado.em > VALIDADE_DO_LINK) {
      const arquivo = await comTempo(ing.cliente.getArquivo(row.remote_id));
      guardado = { link: arquivo.thumbnailLink ?? null, em: Date.now() };
      links.set(lessonId, guardado);
    }
    if (!guardado.link) return 'sem-capa';
    const bytes = await comTempo(baixarImagemDoGoogle(ing, maior(guardado.link)));
    if (!bytes) {
      // O link pode ter vencido antes da hora: o próximo pedido busca outro.
      links.delete(lessonId);
      return 'rede';
    }
    return { bytes };
  } catch {
    return 'rede';
  }
}
