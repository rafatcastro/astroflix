import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';

// A busca do menu principal: as aulas de todos os cursos cujo título tem as
// palavras procuradas. Feita aqui e não com LIKE no SQLite porque o LIKE só ignora
// maiúscula em ASCII e nunca ignora acento ("introducao" não achava "Introdução").
// Mesmo com dezenas de milhares de aulas, varrer os títulos em memória leva poucos ms.

const LIMITE = 80;

const paraBusca = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

interface Linha {
  id: string;
  titulo: string;
  modulo: string | null;
  curso_id: string;
  curso: string;
  categoria_id: string | null;
  duracao: number | null;
  concluida: number | null;
}

export async function buscaRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/api/busca/aulas', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '');
    const palavras = paraBusca(q).split(/\s+/).filter(Boolean);
    if (!palavras.length) return { aulas: [], total: 0 };
    const linhas = db
      .prepare(
        `SELECT l.id, COALESCE(l.titulo_editado, l.title) AS titulo, l.module AS modulo, c.id AS curso_id, c.title AS curso,
                c.collection_id AS categoria_id, l.duration_sec AS duracao, p.completed AS concluida
           FROM lessons l
           JOIN courses c ON c.id = l.course_id
           LEFT JOIN progress p ON p.lesson_id = l.id
          WHERE c.archived = 0 AND l.missing = 0
          ORDER BY c.title COLLATE NOCASE, l.module_order, l.order_index`,
      )
      .all() as unknown as Linha[];
    const achadas = linhas.filter((l) => {
      const t = paraBusca(l.titulo);
      return palavras.every((p) => t.includes(p));
    });
    return {
      total: achadas.length,
      aulas: achadas.slice(0, LIMITE).map((l) => ({
        id: l.id,
        titulo: l.titulo,
        modulo: l.modulo,
        cursoId: l.curso_id,
        curso: l.curso,
        categoriaId: l.categoria_id,
        duracaoSec: l.duracao,
        concluida: !!l.concluida,
      })),
    };
  });
}
