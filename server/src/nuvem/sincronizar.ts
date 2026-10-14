import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { transaction, type Db } from '../db';
import { PLAYABLE_EXTS } from '../scan/derive';
import { FalhaNuvem, type ClienteSupabase } from './cliente';

// A nuvem é a fonte da verdade da conta; o SQLite é o cache em que as rotas leem.
// Subida: os gatilhos da v5 anotam em nuvem_fila o que mudou, e aqui a fila vira
// upserts no Supabase. Descida: o que o banco carimbou depois da última marca de
// cada tabela é aplicado no cache, com os gatilhos calados (sem eco).
//
// A identidade de cada coisa é a mesma do backup: curso pelo id (o mesmo uuid aqui
// e lá), aula e progresso pelo rel_path dentro do curso (o id local da aula muda
// de máquina para máquina). O caminho da pasta de um curso local é desta máquina:
// cada computador grava o seu em pastas_por_maquina.

export interface EstadoNuvem {
  sincronizando: boolean;
  ultimaSincronizacao: string | null;
  pendentes: number;
  erro: 'sem-conexao' | 'sessao-expirada' | 'recusado' | null;
}

export interface Sincronizador {
  /** Sobe a fila e desce o que mudou. Uma de cada vez; nunca rejeita. */
  sincronizar(): Promise<EstadoNuvem>;
  estado(): EstadoNuvem;
  /** Entrou uma conta: troca de dono limpa o cache; primeira entrada sobe tudo o que já existe. */
  aoEntrar(userId: string): void;
  /** Saiu da conta: esquece as marcas de descida (a próxima conta começa do zero). */
  aoSair(): void;
  /** Liga a sincronização periódica (só o app de verdade; os testes chamam sincronizar()). */
  iniciar(intervaloMs?: number): void;
  parar(): void;
}

const LOTE = 500;
const PAGINA = 1000;
// Ordem importa: aula e progresso apontam para o curso (chave estrangeira lá).
const ORDEM = ['colecao', 'curso', 'aula', 'progresso', 'flashcard', 'documento'] as const;
type Item = (typeof ORDEM)[number];

const TABELA_NUVEM: Record<Item, { tabela: string; conflito: string }> = {
  colecao: { tabela: 'colecoes', conflito: 'id' },
  curso: { tabela: 'cursos', conflito: 'id' },
  aula: { tabela: 'aulas', conflito: 'curso_id,rel_path' },
  progresso: { tabela: 'progresso', conflito: 'curso_id,rel_path' },
  flashcard: { tabela: 'flashcards', conflito: 'id' },
  documento: { tabela: 'documentos', conflito: 'id' },
};
const DESCIDA = ['colecoes', 'cursos', 'aulas', 'progresso', 'flashcards', 'pastas_por_maquina', 'documentos', 'documentos_por_maquina'] as const;
// Os PDFs chegaram depois da conta: um projeto em que o schema.sql novo ainda não
// foi aplicado não tem essas tabelas (404). Nesse caso elas esperam na fila, sem
// derrubar a sincronização dos cursos.
const TABELAS_NOVAS = new Set(['documentos', 'documentos_por_maquina']);
const tabelaAusente = (tabela: string, e: unknown) => TABELAS_NOVAS.has(tabela) && e instanceof FalhaNuvem && e.status === 404;

const tipoDaFalha = (e: unknown): EstadoNuvem['erro'] => (e instanceof FalhaNuvem ? e.tipo : 'sem-conexao');
const bool = (v: unknown) => v === true || v === 1;

export function criarSincronizador(deps: {
  db: Db;
  supabase: ClienteSupabase;
  token: () => Promise<string>;
  /** Avisa as rotas quando a descida mexeu no cache (para nada ficar velho na tela). */
  aoMudarCache?: () => void;
}): Sincronizador {
  const { db, supabase } = deps;
  let rodando: Promise<EstadoNuvem> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const est: EstadoNuvem = { sincronizando: false, ultimaSincronizacao: null, pendentes: 0, erro: null };

  const lerEstado = (k: string) =>
    (db.prepare('SELECT valor FROM nuvem_estado WHERE chave=?').get(k) as { valor: string | null } | undefined)?.valor ?? null;
  const gravarEstado = (k: string, v: string | null) =>
    db.prepare('INSERT INTO nuvem_estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').run(k, v);
  const apagarEstado = (k: string) => db.prepare('DELETE FROM nuvem_estado WHERE chave=?').run(k);

  // Um id por computador, para a nuvem saber onde fica a pasta de cada curso local nele.
  function maquinaId(): string {
    let id = lerEstado('maquina');
    if (!id) {
      id = randomUUID();
      gravarEstado('maquina', id);
    }
    return id;
  }

  /** Escreve no cache sem acordar os gatilhos (o que veio da nuvem não sobe de volta). */
  function aplicando(fn: () => void): void {
    transaction(db, () => {
      gravarEstado('aplicando', '1');
      try {
        fn();
      } finally {
        apagarEstado('aplicando');
      }
    });
  }

  const pendentes = () => (db.prepare('SELECT COUNT(*) AS n FROM nuvem_fila').get() as { n: number }).n;

  // ---------- subida ----------

  function linhaDe(item: Item, chave: string): { linha: Record<string, unknown>; pasta?: Record<string, unknown> } | null {
    switch (item) {
      case 'colecao': {
        const c = db.prepare('SELECT * FROM collections WHERE id=?').get(chave) as any;
        return c
          ? { linha: { id: c.id, nome: c.name, sort_index: c.sort_index, criado_em: c.created_at, excluido: false } }
          : { linha: { id: chave, nome: '', sort_index: null, criado_em: new Date().toISOString(), excluido: true } };
      }
      case 'curso': {
        const c = db
          .prepare('SELECT c.*, (SELECT rel_path FROM lessons WHERE id = c.poster_lesson_id) AS capa FROM courses c WHERE c.id=?')
          .get(chave) as any;
        if (!c) {
          return {
            linha: {
              id: chave, titulo: '', origem: 'local', raiz: '', drive_folder_id: null, drive_resource_key: null, telegram_peer: null,
              estrutura: 'flat', arquivado: false, sort_index: null, colecao_id: null, capa_rel_path: null,
              criado_em: new Date().toISOString(), excluido: true,
            },
          };
        }
        const origem = c.source === 'drive' || c.source === 'telegram' ? c.source : 'local';
        return {
          linha: {
            id: c.id, titulo: c.title, origem, raiz: c.root_path, drive_folder_id: c.drive_folder_id ?? null,
            drive_resource_key: c.drive_resource_key ?? null, telegram_peer: c.telegram_peer ?? null, estrutura: c.structure,
            arquivado: !!c.archived, sort_index: c.sort_index, colecao_id: c.collection_id, capa_rel_path: c.capa ?? null,
            criado_em: c.created_at, excluido: false,
          },
          pasta: origem === 'local' ? { curso_id: c.id, maquina_id: maquinaId(), caminho: c.root_path } : undefined,
        };
      }
      case 'aula': {
        let k: { curso: string; rel: string };
        try {
          k = JSON.parse(chave);
        } catch {
          return null;
        }
        // Curso apagado leva as aulas em cascata: o "excluído" do curso já conta isso.
        if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(k.curso)) return null;
        const l = db.prepare('SELECT * FROM lessons WHERE course_id=? AND rel_path=?').get(k.curso, k.rel) as any;
        return l
          ? {
              linha: {
                curso_id: l.course_id, rel_path: l.rel_path, titulo: l.title, modulo: l.module, order_index: l.order_index,
                module_order: l.module_order, duracao_sec: l.duration_sec, remote_id: l.remote_id ?? null, excluido: false,
              },
            }
          : {
              linha: {
                curso_id: k.curso, rel_path: k.rel, titulo: '', modulo: null, order_index: 0, module_order: 0, duracao_sec: null,
                remote_id: null, excluido: true,
              },
            };
      }
      case 'progresso': {
        const p = db
          .prepare('SELECT p.*, l.course_id, l.rel_path FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.lesson_id=?')
          .get(chave) as any;
        // Sem linha: a aula sumiu (já tratada na aula) ou o progresso foi zerado. Zerar
        // não desce para as outras máquinas: na nuvem o progresso só anda para a frente.
        if (!p) return null;
        return {
          linha: {
            curso_id: p.course_id, rel_path: p.rel_path, posicao_sec: p.position_sec, mais_longe_sec: p.furthest_sec,
            duracao_sec: p.duration_sec, concluida: !!p.completed, concluida_em: p.completed_at, auto_concluida: !!p.auto_completed,
            alterado_em: p.updated_at,
          },
        };
      }
      case 'flashcard': {
        const f = db
          .prepare('SELECT f.*, l.rel_path FROM flashcards f LEFT JOIN lessons l ON l.id = f.lesson_id WHERE f.id=?')
          .get(chave) as any;
        return f
          ? {
              linha: {
                id: f.id, curso_id: f.course_id, aula_rel_path: f.rel_path ?? null, minuto_sec: f.minuto_sec, frente: f.frente,
                verso: f.verso, anki_note_id: f.anki_note_id, criado_em: f.criado_em, excluido: f.pendente === 'apagar',
              },
            }
          : {
              linha: {
                id: chave, curso_id: null, aula_rel_path: null, minuto_sec: null, frente: '', verso: '', anki_note_id: null,
                criado_em: new Date().toISOString(), excluido: true,
              },
            };
      }
      case 'documento': {
        const d = db.prepare('SELECT * FROM documentos WHERE id=?').get(chave) as any;
        if (!d) {
          return {
            linha: {
              id: chave, titulo: '', categoria: null, tamanho: 0, paginas: null, pagina: 1, lido: false, lido_em: null,
              leitura_em: null, criado_em: new Date().toISOString(), excluido: true,
            },
          };
        }
        return {
          linha: {
            id: d.id, titulo: d.titulo, categoria: d.categoria, tamanho: d.tamanho, paginas: d.paginas, pagina: d.pagina,
            lido: !!d.lido, lido_em: d.lido_em, leitura_em: d.leitura_em, criado_em: d.criado_em, excluido: false,
          },
          // O arquivo é desta máquina, como a pasta de um curso local.
          pasta: d.caminho ? { documento_id: d.id, maquina_id: maquinaId(), caminho: d.caminho } : undefined,
        };
      }
    }
  }

  async function subir(token: string): Promise<void> {
    for (const item of ORDEM) {
      for (;;) {
        const fila = db
          .prepare('SELECT seq, chave FROM nuvem_fila WHERE tabela=? ORDER BY seq LIMIT ?')
          .all(item, LOTE) as Array<{ seq: number; chave: string }>;
        if (!fila.length) break;
        const linhas: Record<string, unknown>[] = [];
        const pastas: Record<string, unknown>[] = [];
        for (const f of fila) {
          const r = linhaDe(item, f.chave);
          if (!r) continue;
          linhas.push(r.linha);
          if (r.pasta) pastas.push(r.pasta);
        }
        const { tabela, conflito } = TABELA_NUVEM[item];
        try {
          await supabase.upsert(token, tabela, linhas, conflito);
          if (pastas.length) {
            if (item === 'documento') await supabase.upsert(token, 'documentos_por_maquina', pastas, 'documento_id,maquina_id');
            else await supabase.upsert(token, 'pastas_por_maquina', pastas, 'curso_id,maquina_id');
          }
        } catch (e) {
          if (tabelaAusente(tabela, e)) break;
          throw e;
        }
        // Só os seqs lidos: uma mudança anotada durante o envio ganhou seq novo e fica.
        const apagar = db.prepare('DELETE FROM nuvem_fila WHERE seq=?');
        transaction(db, () => {
          for (const f of fila) apagar.run(f.seq);
        });
        if (fila.length < LOTE) break;
      }
    }
  }

  // ---------- descida ----------

  const extensao = (rel: string) => path.extname(rel).toLowerCase();
  // Capa vem por rel_path e só dá para resolver depois que as aulas do curso desceram.
  const capas = new Map<string, string>();

  function aplicar(tabela: (typeof DESCIDA)[number], r: any, cursosTocados: Set<string>): void {
    switch (tabela) {
      case 'colecoes':
        if (bool(r.excluido)) db.prepare('DELETE FROM collections WHERE id=?').run(r.id);
        else
          db.prepare(
            `INSERT INTO collections (id, name, created_at, sort_index) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_index=excluded.sort_index`,
          ).run(r.id, r.nome, r.criado_em, r.sort_index ?? null);
        return;
      case 'cursos': {
        if (bool(r.excluido)) {
          db.prepare('DELETE FROM courses WHERE id=?').run(r.id);
          return;
        }
        const colecao = r.colecao_id && db.prepare('SELECT 1 FROM collections WHERE id=?').get(r.colecao_id) ? r.colecao_id : null;
        const agora = new Date().toISOString();
        const existe = db.prepare('SELECT 1 FROM courses WHERE id=?').get(r.id);
        if (existe) {
          // A pasta de um curso local é desta máquina: nunca vem da nuvem num curso que já existe aqui.
          db.prepare(
            `UPDATE courses SET title=?, structure=?, archived=?, sort_index=?, collection_id=?, drive_folder_id=?,
               drive_resource_key=?, telegram_peer=?, updated_at=?,
               root_path = CASE WHEN source = 'local' THEN root_path ELSE ? END
             WHERE id=?`,
          ).run(
            r.titulo, r.estrutura, bool(r.arquivado) ? 1 : 0, r.sort_index ?? null, colecao, r.drive_folder_id ?? null,
            r.drive_resource_key ?? null, r.telegram_peer ?? null, agora, r.raiz, r.id,
          );
        } else {
          db.prepare(
            `INSERT INTO courses (id, title, root_path, structure, archived, sort_index, collection_id, created_at, updated_at,
               source, drive_folder_id, drive_resource_key, telegram_peer)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            r.id, r.titulo, r.raiz, r.estrutura, bool(r.arquivado) ? 1 : 0, r.sort_index ?? null, colecao, r.criado_em, agora,
            r.origem, r.drive_folder_id ?? null, r.drive_resource_key ?? null, r.telegram_peer ?? null,
          );
        }
        if (r.capa_rel_path) capas.set(r.id, r.capa_rel_path);
        cursosTocados.add(r.id);
        return;
      }
      case 'aulas': {
        const curso = db.prepare('SELECT source, root_path FROM courses WHERE id=?').get(r.curso_id) as
          | { source: string; root_path: string }
          | undefined;
        if (!curso) return;
        if (bool(r.excluido)) {
          db.prepare('DELETE FROM lessons WHERE course_id=? AND rel_path=?').run(r.curso_id, r.rel_path);
          return;
        }
        const existe = db.prepare('SELECT id FROM lessons WHERE course_id=? AND rel_path=?').get(r.curso_id, r.rel_path);
        if (existe) {
          db.prepare(
            `UPDATE lessons SET title=?, module=?, order_index=?, module_order=?, duration_sec=COALESCE(?, duration_sec),
               remote_id=COALESCE(?, remote_id)
             WHERE course_id=? AND rel_path=?`,
          ).run(r.titulo, r.modulo ?? null, r.order_index, r.module_order, r.duracao_sec ?? null, r.remote_id ?? null, r.curso_id, r.rel_path);
        } else {
          const ext = extensao(r.rel_path);
          // Aula local que esta máquina ainda não tem no disco entra como ausente: o
          // "Re-apontar pasta…" a reata, como no import de um backup.
          const ausente =
            curso.source === 'local' && !fs.existsSync(path.join(curso.root_path, ...String(r.rel_path).split('/'))) ? 1 : 0;
          db.prepare(
            `INSERT INTO lessons (id, course_id, rel_path, module, title, order_index, module_order, duration_sec, size_bytes, mtime,
               container, playable, missing, remote_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
          ).run(
            randomUUID(), r.curso_id, r.rel_path, r.modulo ?? null, r.titulo, r.order_index, r.module_order, r.duracao_sec ?? null,
            ext.replace('.', '') || 'mp4', PLAYABLE_EXTS.has(ext) ? 1 : 0, ausente, r.remote_id ?? null,
          );
        }
        cursosTocados.add(r.curso_id);
        return;
      }
      case 'progresso': {
        const aula = db.prepare('SELECT id FROM lessons WHERE course_id=? AND rel_path=?').get(r.curso_id, r.rel_path) as
          | { id: string }
          | undefined;
        if (!aula) return;
        const local = db.prepare('SELECT * FROM progress WHERE lesson_id=?').get(aula.id) as any;
        // A mesma regra da nuvem (mesclar_progresso): nunca andar para trás; concluir
        // ou desmarcar vale a escolha mais recente.
        const longe = !local || r.mais_longe_sec >= local.furthest_sec;
        const recente = !local || String(r.alterado_em) >= String(local.updated_at);
        db.prepare(
          `INSERT INTO progress (lesson_id, position_sec, furthest_sec, duration_sec, completed, completed_at, auto_completed, updated_at)
           VALUES (@id, @pos, @longe, @dur, @conc, @concEm, @auto, @em)
           ON CONFLICT(lesson_id) DO UPDATE SET position_sec=@pos, furthest_sec=@longe, duration_sec=COALESCE(@dur, duration_sec),
             completed=@conc, completed_at=@concEm, auto_completed=@auto, updated_at=@em`,
        ).run({
          id: aula.id,
          pos: longe ? r.posicao_sec : local.position_sec,
          longe: longe ? r.mais_longe_sec : local.furthest_sec,
          dur: r.duracao_sec ?? null,
          conc: (recente ? bool(r.concluida) : !!local.completed) ? 1 : 0,
          concEm: recente ? (r.concluida_em ?? null) : local.completed_at,
          auto: (recente ? bool(r.auto_concluida) : !!local.auto_completed) ? 1 : 0,
          em: recente ? String(r.alterado_em) : local.updated_at,
        });
        return;
      }
      case 'flashcards': {
        if (bool(r.excluido)) {
          db.prepare('DELETE FROM flashcards WHERE id=?').run(r.id);
          return;
        }
        const curso = r.curso_id && db.prepare('SELECT 1 FROM courses WHERE id=?').get(r.curso_id) ? r.curso_id : null;
        if (r.curso_id && !curso) return; // curso que não está aqui (ainda): desce na próxima volta
        const aula =
          curso && r.aula_rel_path
            ? ((db.prepare('SELECT id FROM lessons WHERE course_id=? AND rel_path=?').get(curso, r.aula_rel_path) as { id: string } | undefined)?.id ?? null)
            : null;
        // O Anki é de cada máquina, mas a conta do AnkiWeb é a mesma: quem criou o
        // card manda ao Anki dele. Card que desce não fica pendente aqui (viraria
        // nota duplicada); um pendente local (edição feita aqui) continua.
        db.prepare(
          `INSERT INTO flashcards (id, course_id, lesson_id, minuto_sec, frente, verso, anki_note_id, pendente, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, lesson_id=excluded.lesson_id, minuto_sec=excluded.minuto_sec,
             frente=excluded.frente, verso=excluded.verso, anki_note_id=COALESCE(excluded.anki_note_id, anki_note_id),
             atualizado_em=excluded.atualizado_em`,
        ).run(r.id, curso, aula, r.minuto_sec ?? null, r.frente, r.verso, r.anki_note_id ?? null, r.criado_em, String(r.atualizado_em));
        return;
      }
      case 'pastas_por_maquina':
        if (r.maquina_id !== maquinaId()) return;
        db.prepare("UPDATE courses SET root_path=? WHERE id=? AND source='local'").run(r.caminho, r.curso_id);
        return;
      case 'documentos': {
        if (bool(r.excluido)) {
          db.prepare('DELETE FROM documentos WHERE id=?').run(r.id);
          return;
        }
        const local = db.prepare('SELECT leitura_em FROM documentos WHERE id=?').get(r.id) as { leitura_em: string | null } | undefined;
        const agora = new Date().toISOString();
        if (!local) {
          // Sem caminho: o PDF é de outra máquina até a pessoa re-apontar (ou até a
          // linha de documentos_por_maquina desta máquina descer, logo depois).
          db.prepare(
            `INSERT INTO documentos (id, titulo, categoria, caminho, tamanho, paginas, pagina, lido, lido_em, leitura_em, criado_em, atualizado_em)
             VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            r.id, r.titulo, r.categoria ?? null, r.tamanho ?? 0, r.paginas ?? null, r.pagina ?? 1, bool(r.lido) ? 1 : 0,
            r.lido_em ?? null, r.leitura_em ?? null, r.criado_em, agora,
          );
          return;
        }
        // A leitura vale a mais recente (a mesma regra de mesclar_leitura na nuvem).
        const recente = !local.leitura_em || (r.leitura_em != null && String(r.leitura_em) >= local.leitura_em);
        db.prepare(
          `UPDATE documentos SET titulo=?, categoria=?, paginas=COALESCE(?, paginas), atualizado_em=? WHERE id=?`,
        ).run(r.titulo, r.categoria ?? null, r.paginas ?? null, agora, r.id);
        if (recente) {
          db.prepare('UPDATE documentos SET pagina=?, lido=?, lido_em=?, leitura_em=? WHERE id=?').run(
            r.pagina ?? 1, bool(r.lido) ? 1 : 0, r.lido_em ?? null, r.leitura_em ?? null, r.id,
          );
        }
        return;
      }
      case 'documentos_por_maquina':
        if (r.maquina_id !== maquinaId()) return;
        db.prepare('UPDATE documentos SET caminho=? WHERE id=?').run(r.caminho, r.documento_id);
        return;
    }
  }

  async function descer(token: string): Promise<boolean> {
    let mudou = false;
    const cursosTocados = new Set<string>();
    for (const tabela of DESCIDA) {
      for (;;) {
        const marca = lerEstado(`marca.${tabela}`);
        let linhas: Array<Record<string, unknown>>;
        try {
          linhas = await supabase.mudancas(token, tabela, marca, PAGINA);
        } catch (e) {
          if (tabelaAusente(tabela, e)) break;
          throw e;
        }
        if (!linhas.length) break;
        aplicando(() => {
          for (const r of linhas) aplicar(tabela, r, cursosTocados);
          gravarEstado(`marca.${tabela}`, String(linhas[linhas.length - 1].atualizado_em));
        });
        mudou = true;
        if (linhas.length < PAGINA) break;
      }
    }
    if (capas.size) {
      aplicando(() => {
        for (const [curso, rel] of capas) {
          db.prepare('UPDATE courses SET poster_lesson_id=(SELECT id FROM lessons WHERE course_id=? AND rel_path=?) WHERE id=?').run(
            curso,
            rel,
            curso,
          );
        }
      });
      capas.clear();
    }
    return mudou;
  }

  async function rodar(): Promise<EstadoNuvem> {
    est.sincronizando = true;
    try {
      const token = await deps.token();
      await subir(token);
      if (await descer(token)) deps.aoMudarCache?.();
      est.erro = null;
      est.ultimaSincronizacao = new Date().toISOString();
    } catch (e) {
      est.erro = tipoDaFalha(e);
    } finally {
      est.sincronizando = false;
      est.pendentes = pendentes();
    }
    return { ...est };
  }

  const sinc: Sincronizador = {
    sincronizar() {
      rodando ??= rodar().finally(() => {
        rodando = null;
      });
      return rodando;
    },
    estado: () => ({ ...est, pendentes: pendentes() }),
    aoEntrar(userId) {
      const dono = lerEstado('dono');
      if (dono && dono !== userId) {
        // Outra conta nesta máquina: a biblioteca da anterior não pode aparecer
        // para ela. Downloads e conversões ficam (são arquivos desta máquina).
        aplicando(() => {
          db.prepare('DELETE FROM flashcards').run();
          db.prepare('DELETE FROM documentos').run();
          db.prepare('DELETE FROM courses').run();
          db.prepare('DELETE FROM collections').run();
          db.prepare('DELETE FROM nuvem_fila').run();
          db.prepare("DELETE FROM nuvem_estado WHERE chave LIKE 'marca.%'").run();
        });
      } else if (!dono) {
        // Primeira conta nesta máquina: tudo o que já existe aqui sobe para ela.
        transaction(db, () => {
          db.exec(`
            INSERT OR IGNORE INTO nuvem_fila (tabela, chave) SELECT 'colecao', id FROM collections;
            INSERT OR IGNORE INTO nuvem_fila (tabela, chave) SELECT 'curso', id FROM courses;
            INSERT OR IGNORE INTO nuvem_fila (tabela, chave)
              SELECT 'aula', json_object('curso', course_id, 'rel', rel_path) FROM lessons;
            INSERT OR IGNORE INTO nuvem_fila (tabela, chave) SELECT 'progresso', lesson_id FROM progress;
            INSERT OR IGNORE INTO nuvem_fila (tabela, chave) SELECT 'flashcard', id FROM flashcards;
            INSERT OR IGNORE INTO nuvem_fila (tabela, chave) SELECT 'documento', id FROM documentos;
          `);
        });
      }
      gravarEstado('dono', userId);
      void sinc.sincronizar();
    },
    aoSair() {
      est.erro = null;
      est.ultimaSincronizacao = null;
    },
    iniciar(intervaloMs = 60_000) {
      if (timer) return;
      void sinc.sincronizar();
      timer = setInterval(() => void sinc.sincronizar(), intervaloMs);
      timer.unref();
    },
    parar() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
  return sinc;
}
