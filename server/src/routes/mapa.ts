import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { transaction, type Db } from '../db';
import type { AppConfig } from '../config';
import { cleanTitle } from '../scan/derive';
import { reorganizarBaixados } from '../armazenamento';
import type { ServicosDrive } from '../drive/servicos';

// O mapeamento do curso (MapearCurso.tsx): a pessoa divide as aulas em módulos,
// arrasta, renomeia e liga um arquivo como descrição. Tudo fica no banco, por
// cima do que o scan derivou das pastas: o app nunca mexe na pasta da pessoa
// (as pastas de um curso local são só-leitura). A aula mapeada guarda módulo,
// ordem e título (reconcile.ts não os recalcula), e só o "Baixar" de um curso do
// Drive ou do Telegram vira pastas de verdade, com a mesma estrutura
// (armazenamento.ts, partesNoCurso).

interface AulaPedida {
  id: string;
  /** Vazio volta ao nome do arquivo. Omitido: fica o título de agora. */
  titulo?: string;
  /** rel_path de um arquivo do curso; '' = nenhuma descrição; null = a adivinhada pelo nome; omitido = fica. */
  descricao?: string | null;
}
interface ModuloPedido {
  /** null = as aulas fora de qualquer módulo, que vêm antes dos módulos. */
  nome: string | null;
  aulas: AulaPedida[];
}

const nomeDoModulo = (n: unknown): string | null => {
  if (typeof n !== 'string') return null;
  // Vira nome de pasta no "Baixar": sem barra, que abriria outra pasta.
  const limpo = n.replace(/[/\\]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return limpo || null;
};

/**
 * Grava a ordem: as aulas fora de módulo primeiro, depois cada módulo na ordem
 * pedida. Módulos com o mesmo nome viram um só. As aulas do curso que não vieram
 * no pedido (ainda não mapeadas) vão para depois de todas.
 */
function gravarOrdem(db: Db, courseId: string, grupos: Array<{ nome: string | null; ids: string[] }>): void {
  const juntos = new Map<string | null, string[]>();
  for (const g of grupos) juntos.set(g.nome, [...(juntos.get(g.nome) ?? []), ...g.ids]);
  const ordenados = [...juntos.entries()].sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : 0));
  const pos = db.prepare('UPDATE lessons SET module=?, module_order=?, order_index=?, mapeada=1 WHERE id=? AND course_id=?');
  let ordem = 0;
  let indiceModulo = 0;
  const vistos = new Set<string>();
  for (const [nome, ids] of ordenados) {
    const mo = nome === null ? 0 : ++indiceModulo;
    for (const id of ids) {
      if (vistos.has(id)) continue;
      vistos.add(id);
      pos.run(nome, mo, ordem++, id, courseId);
    }
  }
  db.prepare('UPDATE lessons SET order_index = 50000 + (order_index % 50000) WHERE course_id=? AND mapeada=0 AND missing=0').run(courseId);
  const temModulo = db.prepare('SELECT 1 FROM lessons WHERE course_id=? AND module IS NOT NULL LIMIT 1').get(courseId);
  db.prepare('UPDATE courses SET structure=?, mapa_pendente=0 WHERE id=?').run(temModulo ? 'modules' : 'flat', courseId);
}

export async function mapaRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig; drive?: ServicosDrive }): Promise<void> {
  const { db, config, drive } = opts;

  // O que já foi baixado vai para a estrutura nova. Como no re-escaneio
  // (routes/migration.ts): os downloads do curso param enquanto isso (um `.part`
  // sendo gravado não pode trocar de lugar) e o "Baixar" continua depois.
  const organizar = async (id: string) => {
    if (!reorganizarBaixados(db, config, id, true)) return 0;
    const e = drive?.baixador.estado(id);
    const continuar = !!e && (e.ativo || e.naFila || e.tentarEm !== null);
    drive?.baixador.cancelar(id);
    await drive?.baixador.soltar(id);
    try {
      return reorganizarBaixados(db, config, id);
    } finally {
      if (continuar) drive?.baixador.baixarCurso(id);
    }
  };

  const existe = (id: string) => !!db.prepare('SELECT 1 FROM courses WHERE id=?').get(id);

  // O mapeamento inteiro, como a tela mostra.
  app.put('/api/courses/:id/mapa', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!existe(id)) return reply.code(404).send({ error: 'not_found' });
    const corpo = req.body as { modulos?: unknown } | undefined;
    if (!Array.isArray(corpo?.modulos)) return reply.code(400).send({ error: 'modulos-invalidos' });
    const modulos = (corpo.modulos as ModuloPedido[]).filter((m) => m && Array.isArray(m.aulas));

    const aulas = new Map(
      (db.prepare('SELECT id, rel_path, title FROM lessons WHERE course_id=?').all(id) as Array<{ id: string; rel_path: string; title: string }>).map(
        (l) => [l.id, l],
      ),
    );
    const materiais = new Set((db.prepare('SELECT rel_path FROM materials WHERE course_id=?').all(id) as Array<{ rel_path: string }>).map((m) => m.rel_path));
    const titulo = db.prepare('UPDATE lessons SET title=?, titulo_editado=? WHERE id=?');
    const descricao = db.prepare('UPDATE lessons SET descricao_rel=? WHERE id=?');

    transaction(db, () => {
      for (const m of modulos) {
        for (const a of m.aulas) {
          const atual = aulas.get(a?.id);
          if (!atual) continue;
          if (typeof a.titulo === 'string') {
            const novo = a.titulo.replace(/\s+/g, ' ').trim().slice(0, 300);
            if (!novo) titulo.run(cleanTitle(path.posix.basename(atual.rel_path)), null, atual.id);
            else if (novo !== atual.title) titulo.run(novo, novo, atual.id);
          }
          if (a.descricao === null || a.descricao === '') descricao.run(a.descricao, atual.id);
          else if (typeof a.descricao === 'string' && materiais.has(a.descricao)) descricao.run(a.descricao, atual.id);
        }
      }
      gravarOrdem(
        db,
        id,
        modulos.map((m) => ({ nome: nomeDoModulo(m.nome), ids: m.aulas.map((a) => a?.id).filter((x) => aulas.has(x)) })),
      );
    });
    return { ok: true, movidos: await organizar(id) };
  });

  // "Agora não" na tela que abre depois de importar: o curso fica como as pastas dele.
  app.post('/api/courses/:id/mapa/pular', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!existe(id)) return reply.code(404).send({ error: 'not_found' });
    db.prepare('UPDATE courses SET mapa_pendente=0 WHERE id=?').run(id);
    return reply.code(204).send();
  });

  // As aulas novas de um curso mapeado (o Telegram ganhou mensagens, o dono pôs
  // vídeos na pasta): cada uma vai para o fim do módulo escolhido. Um nome que
  // ainda não existe cria o módulo, no fim.
  app.post('/api/courses/:id/mapa/aulas', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!existe(id)) return reply.code(404).send({ error: 'not_found' });
    const pedidas = (req.body as { aulas?: unknown } | undefined)?.aulas;
    if (!Array.isArray(pedidas)) return reply.code(400).send({ error: 'aulas-invalidas' });

    const mapeadas = db
      .prepare('SELECT id, module FROM lessons WHERE course_id=? AND mapeada=1 ORDER BY order_index')
      .all(id) as Array<{ id: string; module: string | null }>;
    const grupos: Array<{ nome: string | null; ids: string[] }> = [];
    const grupoDe = (nome: string | null) => {
      let g = grupos.find((x) => x.nome === nome);
      if (!g) grupos.push((g = { nome, ids: [] }));
      return g;
    };
    for (const l of mapeadas) grupoDe(l.module).ids.push(l.id);
    const doCurso = db.prepare('SELECT 1 FROM lessons WHERE id=? AND course_id=?');
    for (const p of pedidas as Array<{ id?: unknown; modulo?: unknown }>) {
      if (typeof p?.id !== 'string' || !doCurso.get(p.id, id)) continue;
      for (const g of grupos) g.ids = g.ids.filter((x) => x !== p.id);
      grupoDe(nomeDoModulo(p.modulo)).ids.push(p.id);
    }
    transaction(db, () => gravarOrdem(db, id, grupos));
    return { ok: true, movidos: await organizar(id) };
  });
}
