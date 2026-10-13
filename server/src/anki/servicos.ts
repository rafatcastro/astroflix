import type { Db } from '../db';
import { FalhaAnki, type ClienteAnki } from './cliente';
import { baralhoDoCurso, deHtml, formatarMinuto, paraHtml } from './texto';

// O espelho local dos cards e a fila de envio para o Anki. O Anki é a fonte da
// verdade (a pessoa revisa e edita lá), mas o Learnflix guarda uma cópia: sem
// ela, com o Anki fechado o painel da aula ficaria vazio e não daria para criar
// nada. Card criado com o Anki fechado fica `pendente` e vai na próxima vez.

export type EstadoAnki = 'conectado' | 'fechado' | 'erro';

export interface ServicosAnki {
  /** Manda ao Anki o que está pendente. Nunca rejeita: devolve o estado da conexão. */
  enviarPendentes(): Promise<EstadoAnki>;
  /** Relê no Anki as notas destes cards: edição feita lá vem para cá, nota apagada lá sai daqui. */
  atualizarDoAnki(cardIds: string[]): Promise<EstadoAnki>;
  /** Pergunta ao Anki agora se ele responde. */
  verificar(): Promise<EstadoAnki>;
  pendentes(): number;
}

interface LinhaCard {
  id: string;
  course_id: string | null;
  lesson_id: string | null;
  minuto_sec: number | null;
  frente: string;
  verso: string;
  anki_note_id: number | null;
  pendente: 'criar' | 'editar' | 'apagar' | null;
  atualizado_em: string;
  course_title: string | null;
  lesson_title: string | null;
}

const estadoDe = (e: unknown): EstadoAnki => (e instanceof FalhaAnki && e.tipo === 'fechado' ? 'fechado' : 'erro');

export function criarServicosAnki(db: Db, cliente: ClienteAnki): ServicosAnki {
  // Uma operação por vez: duas idas em paralelo criariam a mesma nota duas vezes.
  let fila: Promise<unknown> = Promise.resolve();
  const emFila = <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => {});
    return p;
  };

  let modeloPronto = false;
  const baralhosProntos = new Set<string>();

  const linhas = (where: string, ...args: Array<string | number>) =>
    db
      .prepare(
        `SELECT f.*, c.title AS course_title, l.title AS lesson_title
         FROM flashcards f LEFT JOIN courses c ON c.id = f.course_id LEFT JOIN lessons l ON l.id = f.lesson_id
         WHERE ${where} ORDER BY f.criado_em`,
      )
      .all(...args) as unknown as LinhaCard[];

  // De onde o card veio, para quem revisa no Anki sem o vídeo na frente.
  const origem = (c: LinhaCard): string => {
    if (!c.course_title) return 'Geral';
    let o = c.course_title;
    if (c.lesson_title) o += ` › ${c.lesson_title}`;
    if (c.lesson_id && c.minuto_sec != null) o += ` · ${formatarMinuto(c.minuto_sec)}`;
    return o;
  };
  const campos = (c: LinhaCard) => ({ Frente: paraHtml(c.frente), Verso: paraHtml(c.verso), Origem: paraHtml(origem(c)) });

  async function enviar(): Promise<EstadoAnki> {
    const pendentes = linhas('f.pendente IS NOT NULL');
    if (!pendentes.length) return 'conectado';
    let mudou = false;
    let estado: EstadoAnki = 'conectado';
    try {
      if (!modeloPronto) {
        await cliente.garantirModelo();
        modeloPronto = true;
      }
      for (const c of pendentes) {
        try {
          if (c.pendente === 'criar') {
            const baralho = baralhoDoCurso(c.course_id ? c.course_title : null);
            if (!baralhosProntos.has(baralho)) {
              await cliente.garantirBaralho(baralho);
              baralhosProntos.add(baralho);
            }
            const nota = await cliente.adicionar(baralho, campos(c));
            mudou = true;
            // Editado enquanto ia: a nota existe, mas com o texto antigo.
            const r = db
              .prepare(
                `UPDATE flashcards SET anki_note_id=?, pendente=CASE WHEN atualizado_em=? THEN NULL ELSE 'editar' END WHERE id=?`,
              )
              .run(nota, c.atualizado_em, c.id);
            // Apagado enquanto ia: a nota não pode ficar órfã no Anki.
            if (!r.changes) await cliente.apagar([nota]);
          } else if (c.pendente === 'editar' && c.anki_note_id != null) {
            try {
              await cliente.atualizar(c.anki_note_id, campos(c));
            } catch (e) {
              if (estadoDe(e) === 'fechado') throw e;
              // A nota foi apagada no Anki, mas a pessoa acabou de editar o card
              // aqui: ela quer o card, então ele volta como nota nova.
              if ((await cliente.ler([c.anki_note_id])).length) throw e;
              db.prepare("UPDATE flashcards SET anki_note_id=NULL, pendente='criar' WHERE id=?").run(c.id);
              continue;
            }
            mudou = true;
            db.prepare('UPDATE flashcards SET pendente=NULL WHERE id=? AND atualizado_em=?').run(c.id, c.atualizado_em);
          } else if (c.pendente === 'apagar') {
            if (c.anki_note_id != null) await cliente.apagar([c.anki_note_id]);
            mudou = true;
            db.prepare('DELETE FROM flashcards WHERE id=?').run(c.id);
          }
        } catch (e) {
          // Anki fechou no meio: o resto fica para a próxima. Erro de um card só
          // (o Anki recusou) não segura os outros.
          if (estadoDe(e) === 'fechado') throw e;
          estado = 'erro';
        }
      }
    } catch (e) {
      modeloPronto = false;
      baralhosProntos.clear();
      return estadoDe(e);
    }
    // Leva para o AnkiWeb (e daí para o celular). Sem esperar: leva segundos, e
    // sem login no AnkiWeb o Anki só recusa.
    if (mudou) void cliente.sincronizar().catch(() => {});
    return estado;
  }

  async function atualizar(cardIds: string[]): Promise<EstadoAnki> {
    if (!cardIds.length) return 'conectado';
    const marcadores = cardIds.map(() => '?').join(',');
    const cards = linhas(`f.id IN (${marcadores}) AND f.pendente IS NULL AND f.anki_note_id IS NOT NULL`, ...cardIds);
    if (!cards.length) return 'conectado';
    let notas;
    try {
      notas = await cliente.ler(cards.map((c) => c.anki_note_id!));
    } catch (e) {
      return estadoDe(e);
    }
    // Nenhuma nota encontrada de todas que pedimos: muito provavelmente o Anki
    // está aberto noutro perfil, e não que a pessoa apagou tudo. Apagar aqui
    // jogaria fora os cards dela.
    if (!notas.length) return 'conectado';
    const porId = new Map(notas.map((n) => [n.id, n]));
    const apagar = db.prepare('DELETE FROM flashcards WHERE id=? AND pendente IS NULL AND atualizado_em=?');
    const gravar = db.prepare('UPDATE flashcards SET frente=?, verso=? WHERE id=? AND pendente IS NULL AND atualizado_em=?');
    for (const c of cards) {
      const n = porId.get(c.anki_note_id!);
      if (!n) {
        apagar.run(c.id, c.atualizado_em);
        continue;
      }
      const frente = deHtml(n.campos.Frente ?? '');
      const verso = deHtml(n.campos.Verso ?? '');
      if (frente !== c.frente || verso !== c.verso) gravar.run(frente, verso, c.id, c.atualizado_em);
    }
    return 'conectado';
  }

  return {
    enviarPendentes: () => emFila(enviar),
    atualizarDoAnki: (ids) => emFila(() => atualizar(ids)),
    async verificar() {
      try {
        await cliente.versao();
        return 'conectado';
      } catch (e) {
        return estadoDe(e);
      }
    },
    pendentes: () => (db.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE pendente IS NOT NULL').get() as { n: number }).n,
  };
}
