import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { BaixarArquivo } from './baixar';
import { arquivoBaixadoDoMaterial, arquivoLocalDaAula } from './local';
import { FalhaDrive } from './tipos';
import { FalhaTelegram } from '../telegram/tipos';

// "Baixar" na página do curso: o curso inteiro do Drive ou do Telegram, aulas e
// materiais, numa pasta com os nomes reais dentro de Downloads. É outra coisa que
// a cópia do app (drive/baixar.ts), que só guarda a aula aberta e as próximas,
// com o id no nome, e apaga as concluídas: esta é da pessoa, e o app nunca mexe
// nela depois. Fila própria, um curso por vez, para não furar a regra do
// baixador de só baixar sob demanda.

export interface EstadoExportacao {
  ativo: boolean;
  feitos: number;
  total: number;
  bytesFeitos: number;
  bytesTotal: number;
  /** Motivo da parada (tipo de FalhaDrive/FalhaTelegram, 'sem-espaco'), ou null. */
  erro: string | null;
  /** A pasta do curso dentro de Downloads. */
  pasta: string;
}

export interface Exportador {
  exportar(courseId: string): void;
  cancelar(courseId: string): void;
  estado(courseId: string): EstadoExportacao | null;
  /** A pasta Downloads onde as cópias ficam. */
  pasta(): string;
}

interface Item {
  remoteId: string;
  destino: string;
  tamanho: number;
  /** Cópia que o app já baixou (aula aberta, material): copia em vez de baixar de novo. */
  local: string | null;
}

// Os nomes vêm do dono da pasta do Drive ou do grupo: nada de "..", separador ou
// caractere que o Windows recusa, nem ponto ou espaço no fim.
const sanear = (nome: string): string =>
  nome
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .replace(/^\.+$/, '_') || '_';

export function criarExportador(deps: {
  db: Db;
  config: AppConfig;
  fonte: (courseId: string) => Promise<BaixarArquivo | null>;
  pastaDownloads: () => string;
}): Exportador {
  const { db, config } = deps;
  const fila: string[] = [];
  const estados = new Map<string, EstadoExportacao>();
  let atual: { id: string; ac: AbortController } | null = null;
  let rodando = false;

  function itensDo(courseId: string, pasta: string, telegram: boolean): Item[] {
    const aulas = db
      .prepare('SELECT id, rel_path, remote_id, size_bytes FROM lessons WHERE course_id=? AND missing=0 AND remote_id IS NOT NULL')
      .all(courseId) as Array<{ id: string; rel_path: string; remote_id: string; size_bytes: number }>;
    const materiais = db
      .prepare('SELECT id, rel_path, remote_id, size_bytes FROM materials WHERE course_id=? AND remote_id IS NOT NULL')
      .all(courseId) as Array<{ id: string; rel_path: string; remote_id: string; size_bytes: number }>;

    const caminhos = [
      ...aulas.map((a) => {
        const l = arquivoLocalDaAula(config, courseId, a.id, a.rel_path);
        return { ...a, local: l && !l.convertido ? l.arquivo : null };
      }),
      ...materiais.map((m) => {
        const l = config.downloadsDir ? arquivoBaixadoDoMaterial(config, courseId, m.id, m.rel_path) : null;
        return { ...m, local: l && fs.existsSync(l) ? l : null };
      }),
    ].map((x) => ({ ...x, partes: x.rel_path.split('/').map(sanear) }));

    // No Telegram o nome no disco começa pelo id da mensagem (a ordem de
    // postagem): fora do app ele só atrapalha, e sai quando não deixa dois
    // arquivos com o mesmo nome.
    if (telegram) {
      const semPrefixo = (partes: string[]) => [...partes.slice(0, -1), partes[partes.length - 1].replace(/^\d{10}-/, '')].join('/');
      const contagem = new Map<string, number>();
      for (const c of caminhos) contagem.set(semPrefixo(c.partes).toLowerCase(), (contagem.get(semPrefixo(c.partes).toLowerCase()) ?? 0) + 1);
      for (const c of caminhos) if (contagem.get(semPrefixo(c.partes).toLowerCase()) === 1) c.partes = semPrefixo(c.partes).split('/');
    }

    return caminhos.flatMap((c) => {
      const destino = path.join(pasta, ...c.partes);
      // Saneado, não escapa; a conferência fica como a última barreira.
      if (!destino.startsWith(pasta + path.sep)) return [];
      return [{ remoteId: c.remote_id, destino, tamanho: Number(c.size_bytes), local: c.local }];
    });
  }

  const pronto = (it: Item) => fs.existsSync(it.destino) && (it.tamanho <= 0 || fs.statSync(it.destino).size === it.tamanho);

  async function exportarCurso(courseId: string, estado: EstadoExportacao, signal: AbortSignal): Promise<void> {
    const curso = db.prepare('SELECT source FROM courses WHERE id=?').get(courseId) as { source: string } | undefined;
    if (!curso) return;
    const itens = itensDo(courseId, estado.pasta, curso.source === 'telegram');
    estado.total = itens.length;
    estado.bytesTotal = itens.reduce((s, it) => s + Math.max(it.tamanho, 0), 0);
    const faltam = itens.filter((it) => !pronto(it));
    estado.feitos = itens.length - faltam.length;
    estado.bytesFeitos = estado.bytesTotal - faltam.reduce((s, it) => s + Math.max(it.tamanho, 0), 0);

    // Um curso passa fácil de 40 GB: não cabendo, nem começa, em vez de encher o
    // disco e parar no meio.
    const base = fs.existsSync(estado.pasta) ? estado.pasta : path.dirname(estado.pasta);
    const livre = (() => {
      try {
        const s = fs.statfsSync(base);
        return s.bavail * s.bsize;
      } catch {
        return Infinity;
      }
    })();
    if (estado.bytesTotal - estado.bytesFeitos > livre) throw Object.assign(new Error('sem espaço'), { code: 'ENOSPC' });

    let baixar: BaixarArquivo | null = null;
    for (const it of faltam) {
      if (signal.aborted) return;
      fs.mkdirSync(path.dirname(it.destino), { recursive: true });
      if (it.local) {
        await fs.promises.copyFile(it.local, it.destino);
      } else {
        baixar ??= await deps.fonte(courseId);
        if (!baixar) throw new FalhaDrive('sem-conexao');
        await baixar(it.remoteId, it.destino, it.tamanho, signal);
      }
      estado.feitos++;
      estado.bytesFeitos += Math.max(it.tamanho, 0);
    }
  }

  async function rodar(): Promise<void> {
    if (rodando) return;
    rodando = true;
    while (fila.length) {
      const id = fila.shift()!;
      const estado = estados.get(id)!;
      const ac = new AbortController();
      atual = { id, ac };
      try {
        await exportarCurso(id, estado, ac.signal);
        estado.erro = null;
      } catch (e) {
        if (ac.signal.aborted) estado.erro = null;
        else
          estado.erro =
            e instanceof FalhaDrive || e instanceof FalhaTelegram
              ? e.tipo
              : (e as NodeJS.ErrnoException)?.code === 'ENOSPC'
                ? 'sem-espaco'
                : 'sem-conexao';
      }
      atual = null;
      estado.ativo = false;
    }
    rodando = false;
  }

  return {
    exportar(courseId) {
      const curso = db.prepare('SELECT title FROM courses WHERE id=?').get(courseId) as { title: string } | undefined;
      if (!curso || estados.get(courseId)?.ativo) return;
      const pasta = path.join(deps.pastaDownloads(), sanear(curso.title));
      // Na fila atrás de outros (o "Baixar" da categoria enfileira vários), o
      // total já conta: a barra da categoria soma todos desde o começo.
      const t = db
        .prepare(
          `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM (
             SELECT size_bytes FROM lessons WHERE course_id=@id AND missing=0 AND remote_id IS NOT NULL
             UNION ALL SELECT size_bytes FROM materials WHERE course_id=@id AND remote_id IS NOT NULL)`,
        )
        .get({ id: courseId }) as { n: number; b: number };
      estados.set(courseId, { ativo: true, feitos: 0, total: Number(t.n), bytesFeitos: 0, bytesTotal: Number(t.b), erro: null, pasta });
      fila.push(courseId);
      void rodar();
    },
    cancelar(courseId) {
      const i = fila.indexOf(courseId);
      if (i >= 0) fila.splice(i, 1);
      const e = estados.get(courseId);
      if (e && i >= 0) e.ativo = false;
      // O `.part` fica: rodar de novo continua dele.
      if (atual?.id === courseId) atual.ac.abort();
    },
    estado: (courseId) => estados.get(courseId) ?? null,
    pasta: () => deps.pastaDownloads(),
  };
}
