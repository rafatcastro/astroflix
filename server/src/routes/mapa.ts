import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { transaction, type Db } from '../db';
import type { AppConfig } from '../config';
import { cleanTitle } from '../scan/derive';
import { parciaisAntes, reorganizarBaixados, type Parciais } from '../armazenamento';
import type { ServicosDrive } from '../drive/servicos';
import { FalhaClaude, perguntarAoClaude } from '../claude';

// O mapeamento do curso do Telegram (MapearCurso.tsx): a pessoa divide as aulas
// em módulos e submódulos, arrasta, renomeia e liga um arquivo como descrição. O
// canal não tem pastas, então a estrutura só existe no banco: a aula mapeada guarda
// módulo (o caminho "A/B"), ordem e título (reconcile.ts não os recalcula), e só o
// "Baixar" vira pastas de verdade, uma por nível (armazenamento.ts, partesNoCurso).

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

// Só o Telegram tem mapeamento: num curso local ou do Drive a árvore é a das
// pastas, e mexer nela por cima estragava a ordem que a pasta já dava. Cinco
// níveis bastam para um canal e mantêm o caminho do "Baixar" curto (Windows).
const MAX_NIVEIS = 5;

/**
 * O módulo é um caminho "A/B" (submódulos). Cada parte vira nome de pasta no
 * "Baixar", então é saneada à parte (a barra invertida dentro de um nome vira
 * "-", a "/" já separou os níveis); partes vazias somem e o fundo para em 5 níveis.
 */
const nomeDoModulo = (n: unknown): string | null => {
  if (typeof n !== 'string') return null;
  const partes = n
    .split('/')
    .map((p) => p.replace(/\\/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120).trim())
    .filter(Boolean)
    .slice(0, MAX_NIVEIS);
  return partes.length ? partes.join('/') : null;
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
  // `antes`: onde estavam os downloads interrompidos, tirado antes de gravar o
  // mapeamento novo (senão o `.part` do caminho antigo não seria mais achado).
  const organizar = async (id: string, antes: Parciais) => {
    if (!reorganizarBaixados(db, config, id, true, antes)) return 0;
    const e = drive?.baixador.estado(id);
    const continuar = !!e && (e.ativo || e.naFila || e.tentarEm !== null);
    drive?.baixador.cancelar(id);
    await drive?.baixador.soltar(id);
    try {
      return reorganizarBaixados(db, config, id, false, antes);
    } finally {
      if (continuar) drive?.baixador.baixarCurso(id);
    }
  };

  const existe = (id: string) => !!db.prepare('SELECT 1 FROM courses WHERE id=?').get(id);
  const doTelegram = (id: string) => !!db.prepare("SELECT 1 FROM courses WHERE id=? AND source='telegram'").get(id);

  // O mapeamento inteiro, como a tela mostra.
  app.put('/api/courses/:id/mapa', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!existe(id)) return reply.code(404).send({ error: 'not_found' });
    if (!doTelegram(id)) return reply.code(400).send({ error: 'so-telegram' });
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
    const antes = parciaisAntes(db, id);

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
    return { ok: true, movidos: await organizar(id, antes) };
  });

  // "Organizar por texto…" (menu ⋯): a pessoa escreve ou cola um texto (o menu do
  // canal, a ementa, "junte as aulas 1 a 5 em Introdução") e o Claude Code dela
  // propõe os módulos, a ordem e os títulos. Nada é gravado aqui: a proposta abre na
  // tela de mapeamento, para a pessoa conferir e salvar (um erro do Claude não
  // bagunça o curso sem ela ver). As aulas vão numeradas (1..N), e não pelos ids,
  // para o Claude não ter de copiar UUIDs; o que ele não citar fica fora dos módulos.
  app.post('/api/courses/:id/mapa/texto', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!existe(id)) return reply.code(404).send({ error: 'not_found' });
    if (!doTelegram(id)) return reply.code(400).send({ error: 'so-telegram' });
    const texto = String((req.body as { texto?: unknown } | undefined)?.texto ?? '').trim().slice(0, 50_000);
    if (!texto) return reply.code(400).send({ error: 'texto-vazio' });

    const aulas = db
      .prepare('SELECT id, rel_path, title, module FROM lessons WHERE course_id=? AND missing=0 ORDER BY order_index')
      .all(id) as Array<{ id: string; rel_path: string; title: string; module: string | null }>;
    if (!aulas.length) return reply.code(400).send({ error: 'sem-aulas' });
    const lista = aulas
      .map((l, i) => {
        const arquivo = path.posix.basename(l.rel_path).replace(/^\d{10}-/, '');
        return `${i + 1}. ${l.title} | arquivo: ${arquivo}${l.module ? ` | módulo atual: ${l.module}` : ''}`;
      })
      .join('\n');
    const prompt = `Você organiza as aulas de um curso em vídeo em módulos, seguindo as instruções da pessoa.

INSTRUÇÕES DA PESSOA (pode ser o índice do curso, uma ementa ou um pedido livre):
"""
${texto}
"""

AULAS DO CURSO (número. título atual | arquivo | módulo atual), na ordem de postagem:
${lista}

Responda com os módulos na ordem em que devem aparecer. Cada módulo tem "nome" e "aulas" (os números das aulas, na ordem em que devem tocar). Para um submódulo, use "Módulo/Submódulo" no nome (até 5 níveis). Use os nomes de módulo do texto da pessoa quando houver. Em cada aula, "titulo" só quando o texto der um nome melhor para ela; senão omita. Cada aula aparece no máximo uma vez. Aulas que o texto não permite situar ficam de fora (não invente módulos para elas).`;
    const schema = {
      type: 'object',
      properties: {
        modulos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nome: { type: 'string' },
              aulas: {
                type: 'array',
                items: { type: 'object', properties: { n: { type: 'integer' }, titulo: { type: 'string' } }, required: ['n'] },
              },
            },
            required: ['nome', 'aulas'],
          },
        },
      },
      required: ['modulos'],
    };

    let resposta: { modulos?: Array<{ nome?: unknown; aulas?: Array<{ n?: unknown; titulo?: unknown }> }> };
    try {
      resposta = await perguntarAoClaude(prompt, schema);
    } catch (e) {
      if (e instanceof FalhaClaude) return reply.code(e.tipo === 'sem-claude' ? 424 : 502).send({ error: e.tipo, mensagem: e.message });
      throw e;
    }

    const usadas = new Set<number>();
    const modulos: Array<{ nome: string | null; aulas: Array<{ id: string; titulo: string }> }> = [];
    for (const m of Array.isArray(resposta?.modulos) ? resposta.modulos : []) {
      const nome = nomeDoModulo(m?.nome);
      if (!nome || !Array.isArray(m.aulas)) continue;
      const dele: Array<{ id: string; titulo: string }> = [];
      for (const a of m.aulas) {
        const n = typeof a?.n === 'number' ? a.n : NaN;
        if (!Number.isInteger(n) || n < 1 || n > aulas.length || usadas.has(n)) continue;
        usadas.add(n);
        const titulo = typeof a.titulo === 'string' ? a.titulo.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        dele.push({ id: aulas[n - 1].id, titulo: titulo || aulas[n - 1].title });
      }
      // Dois módulos com o mesmo nome viram um só, como no salvar.
      const igual = modulos.find((x) => x.nome === nome);
      if (igual) igual.aulas.push(...dele);
      else if (dele.length) modulos.push({ nome, aulas: dele });
    }
    if (!modulos.length) return reply.code(502).send({ error: 'resposta-invalida', mensagem: 'O Claude não montou nenhum módulo com esse texto.' });
    const fora = aulas.filter((_, i) => !usadas.has(i + 1)).map((l) => ({ id: l.id, titulo: l.title }));
    return { modulos: [{ nome: null, aulas: fora }, ...modulos] };
  });

  // "Agora não" na tela que abre depois de importar: o curso fica como as pastas dele.
  // Aceita qualquer curso: limpa a pendência que ficou de quando a pasta e o Drive
  // também abriam o mapeamento.
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
    if (!doTelegram(id)) return reply.code(400).send({ error: 'so-telegram' });
    const pedidas = (req.body as { aulas?: unknown } | undefined)?.aulas;
    if (!Array.isArray(pedidas)) return reply.code(400).send({ error: 'aulas-invalidas' });

    const mapeadas = db
      .prepare('SELECT id, module FROM lessons WHERE course_id=? AND mapeada=1 ORDER BY order_index')
      .all(id) as Array<{ id: string; module: string | null }>;
    const grupos: Array<{ nome: string | null; ids: string[] }> = [];
    const grupoDe = (nome: string | null) => {
      let g = grupos.find((x) => x.nome === nome);
      if (!g) {
        g = { nome, ids: [] };
        // Um módulo "A" que só tem submódulos não tem grupo: no fim do curso, a aula
        // ficaria longe do "A" na árvore e no "Próxima". Entra logo depois da última
        // aula dele ("A/…"), que é onde a árvore a mostra.
        let depois = -1;
        if (nome !== null) grupos.forEach((x, i) => { if (x.nome !== null && x.nome.startsWith(`${nome}/`)) depois = i; });
        if (depois >= 0) grupos.splice(depois + 1, 0, g);
        else grupos.push(g);
      }
      return g;
    };
    for (const l of mapeadas) grupoDe(l.module).ids.push(l.id);
    const doCurso = db.prepare('SELECT 1 FROM lessons WHERE id=? AND course_id=?');
    for (const p of pedidas as Array<{ id?: unknown; modulo?: unknown }>) {
      if (typeof p?.id !== 'string' || !doCurso.get(p.id, id)) continue;
      for (const g of grupos) g.ids = g.ids.filter((x) => x !== p.id);
      grupoDe(nomeDoModulo(p.modulo)).ids.push(p.id);
    }
    const antes = parciaisAntes(db, id);
    transaction(db, () => gravarOrdem(db, id, grupos));
    return { ok: true, movidos: await organizar(id, antes) };
  });
}
