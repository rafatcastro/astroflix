import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { Capacidades } from '../media/ffmpeg';
import { prepararParaTocar } from '../media/preparar';
import type { ClienteDrive } from './api';
import { arquivoBaixadoDaAula, arquivoLocalDaAula } from './local';
import { resourceKeyDoCurso } from './status';
import { FalhaDrive } from './tipos';

// As aulas do Drive são baixadas para DATA_DIR/downloads e, se preciso, convertidas
// para tocar. Assistir pela rede dependia da cota do Google (que bloqueia pastas
// muito acessadas), de conexão boa e do seek ir e voltar ao Drive; com o arquivo
// local, o player é o mesmo dos cursos do disco. Enquanto uma aula não chega, ela
// continua tocando direto do Drive.
//
// Só sob demanda: a aula que a pessoa abre e as JANELA seguintes. A primeira versão
// baixava o curso inteiro ao colar o link (e todos os cursos ao abrir o app): um
// curso só passou de 40 GB e tomou a internet da casa por horas.

export interface EstadoDownload {
  /** Ainda baixando ou convertendo alguma aula deste curso. */
  ativo: boolean;
  /** Motivo da última parada (tipo de FalhaDrive, 'sem-espaco'), ou null. */
  erro: string | null;
}

export interface Baixador {
  /**
   * A pessoa abriu esta aula: baixa ela e as próximas JANELA (as que já estavam
   * pedidas e ainda não começaram deixam de estar).
   */
  pedirAula(lessonId: string): void;
  /**
   * Passa o curso pela fila sem pedir aula nova: limpa as concluídas e termina o
   * que já estava pedido. Chamado ao (des)marcar uma aula como concluída.
   */
  enfileirar(courseId: string): void;
  estado(courseId: string): EstadoDownload;
  /** Ao abrir o app: só limpa as concluídas de cada curso do Drive. Não baixa nada. */
  retomarTodos(): void;
  /** Para os testes: espera a fila esvaziar. */
  aguardar(): Promise<void>;
}

const CHAVE_HEVC = 'player.hevc';
/** Aulas seguintes à aberta que já vão sendo baixadas. */
export const JANELA = 2;

/** O que o player desta máquina toca, informado pela interface ao abrir. */
export function capacidadesSalvas(db: Db): Capacidades {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE_HEVC) as { value: string } | undefined;
  return { hevc: r?.value === '1' };
}

export function salvarCapacidades(db: Db, cap: Capacidades): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    CHAVE_HEVC,
    cap.hevc ? '1' : '0',
  );
}

export function criarBaixador(deps: {
  db: Db;
  config: AppConfig;
  cliente: (resourceKeys: string | null) => ClienteDrive;
}): Baixador {
  const { db, config } = deps;
  const fila: string[] = [];
  const estados = new Map<string, EstadoDownload>();
  // Pedido de novo enquanto o curso já estava sendo baixado (re-escaneou e
  // apareceu aula nova): roda mais uma volta no fim, em vez de perder o pedido.
  const deNovo = new Set<string>();
  // Aulas pedidas e ainda não baixadas, por curso.
  const pedidas = new Map<string, Set<string>>();
  let rodando: Promise<void> | null = null;

  const existe = (courseId: string) => !!db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId);

  async function baixarArquivo(cliente: ClienteDrive, remoteId: string, destino: string, tamanho: number): Promise<void> {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const parcial = `${destino}.part`;
    // Retoma de onde parou: vídeo de aula tem centenas de MB, e cair a rede no
    // meio não pode custar o download inteiro.
    let inicio = fs.existsSync(parcial) ? fs.statSync(parcial).size : 0;
    let res = await cliente.baixar(remoteId, inicio ? `bytes=${inicio}-` : undefined);
    if (inicio && res.status === 416) {
      // O pedaço já estava completo; só faltou renomear.
      await res.body?.cancel();
    } else {
      if (inicio && res.status !== 206) {
        await res.body?.cancel();
        inicio = 0;
        res = await cliente.baixar(remoteId, undefined);
      }
      if (!res.ok || !res.body) throw new FalhaDrive('sem-conexao');
      await pipeline(
        Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
        fs.createWriteStream(parcial, { flags: inicio ? 'a' : 'w' }),
      );
    }
    // Arquivo truncado tocaria até o meio e pararia: confere com o tamanho do Drive.
    if (tamanho > 0 && fs.statSync(parcial).size !== tamanho) {
      fs.rmSync(parcial, { force: true });
      throw new FalhaDrive('sem-conexao');
    }
    fs.renameSync(parcial, destino);
  }

  // Curso baixado inteiro ocupa dezenas de GB; o que já foi assistido não precisa
  // ficar. Apaga a cópia (baixada e convertida) das aulas concluídas e mantém tudo
  // no banco. A aula assistida por último fica: concluir a 90% marca a aula com o
  // vídeo ainda rodando, e apagar ali tiraria os minutos finais do disco. Ela sai
  // na próxima conclusão ou quando o app abrir de novo.
  function limparConcluidas(courseId: string): Set<string> {
    const concluidas = db
      .prepare('SELECT l.id, l.rel_path FROM lessons l JOIN progress p ON p.lesson_id = l.id WHERE l.course_id=? AND p.completed=1')
      .all(courseId) as Array<{ id: string; rel_path: string }>;
    const ultima = db
      .prepare('SELECT p.lesson_id FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id=? ORDER BY p.updated_at DESC LIMIT 1')
      .get(courseId) as { lesson_id: string } | undefined;
    // Sem a cópia convertida, o que sobra é o original do Drive, que não tocava:
    // a aula volta a dizer isso em vez de abrir um player quebrado.
    const marcarNaoTocavel = db.prepare('UPDATE lessons SET playable=0 WHERE id=?');
    for (const a of concluidas) {
      if (a.id === ultima?.lesson_id) continue;
      const convertido = path.join(config.convertedDir, `${a.id}.mp4`);
      if (fs.existsSync(convertido)) {
        fs.rmSync(convertido, { force: true });
        marcarNaoTocavel.run(a.id);
      }
      const baixado = arquivoBaixadoDaAula(config, courseId, a.id, a.rel_path);
      fs.rmSync(baixado, { force: true });
      fs.rmSync(`${baixado}.part`, { force: true });
    }
    return new Set(concluidas.map((a) => a.id));
  }

  async function baixarCurso(courseId: string): Promise<void> {
    const curso = db.prepare('SELECT drive_folder_id, drive_resource_key FROM courses WHERE id=? AND source=?').get(courseId, 'drive') as
      | { drive_folder_id: string | null; drive_resource_key: string | null }
      | undefined;
    if (!curso) return;
    const cliente = deps.cliente(resourceKeyDoCurso(curso.drive_folder_id, curso.drive_resource_key));

    // Na ordem do curso: as primeiras aulas, que a pessoa assiste primeiro, chegam antes.
    const aulas = db
      .prepare('SELECT id, rel_path, remote_id, size_bytes FROM lessons WHERE course_id=? AND missing=0 AND remote_id IS NOT NULL ORDER BY order_index')
      .all(courseId) as Array<{ id: string; rel_path: string; remote_id: string; size_bytes: number | null }>;
    const marcarTocavel = db.prepare('UPDATE lessons SET playable=1 WHERE id=?');
    const concluidas = limparConcluidas(courseId);

    for (const a of aulas) {
      if (!existe(courseId)) return; // excluído no meio: não baixa mais nada
      // Lido a cada volta: abrir outra aula no meio troca a janela, e o que saiu
      // dela não é mais baixado.
      if (!pedidas.get(courseId)?.has(a.id)) continue;
      // Aula concluída não volta para o disco: foi apagada de propósito, e o
      // progresso (e o resto dos metadados) continua no banco.
      if (concluidas.has(a.id)) continue;
      if (arquivoLocalDaAula(config, courseId, a.id, a.rel_path)) continue;
      const destino = arquivoBaixadoDaAula(config, courseId, a.id, a.rel_path);
      await baixarArquivo(cliente, a.remote_id, destino, Number(a.size_bytes ?? 0));
      pedidas.get(courseId)?.delete(a.id);
      try {
        const convertido = path.join(config.convertedDir, `${a.id}.mp4`);
        if (await prepararParaTocar(destino, convertido, capacidadesSalvas(db))) {
          // A cópia convertida é a que toca: a baixada só ocuparia espaço (o
          // original continua no Drive).
          fs.rmSync(destino, { force: true });
          marcarTocavel.run(a.id);
        }
      } catch {
        // Conversão que falha não perde o download: o player tenta o arquivo
        // baixado e, se não tocar, oferece converter de novo.
      }
    }
    // Materiais não são baixados: abrem direto do Drive quando a pessoa clica.
  }

  async function laco(): Promise<void> {
    while (fila.length) {
      const id = fila[0];
      const estado = estados.get(id)!;
      try {
        await baixarCurso(id);
        estado.erro = null;
      } catch (e) {
        estado.erro =
          e instanceof FalhaDrive ? e.tipo : (e as NodeJS.ErrnoException)?.code === 'ENOSPC' ? 'sem-espaco' : 'sem-conexao';
      }
      fila.shift();
      if (deNovo.delete(id) && !estado.erro) fila.push(id);
      else estado.ativo = false;
    }
  }

  const baixador: Baixador = {
    pedirAula(lessonId) {
      const aula = db
        .prepare("SELECT l.course_id, l.order_index FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id=? AND c.source='drive'")
        .get(lessonId) as { course_id: string; order_index: number } | undefined;
      if (!aula || !config.downloadsDir) return;
      // A aberta e as próximas ainda não concluídas (concluída não volta para o disco).
      const janela = db
        .prepare(
          `SELECT l.id FROM lessons l LEFT JOIN progress p ON p.lesson_id = l.id
           WHERE l.course_id=? AND l.missing=0 AND l.remote_id IS NOT NULL AND l.order_index >= ?
             AND (l.id = ? OR COALESCE(p.completed, 0) = 0)
           ORDER BY l.order_index LIMIT ?`,
        )
        .all(aula.course_id, aula.order_index, lessonId, JANELA + 1) as Array<{ id: string }>;
      pedidas.set(aula.course_id, new Set(janela.map((a) => a.id)));
      baixador.enfileirar(aula.course_id);
    },
    enfileirar(courseId) {
      if (!config.downloadsDir) return; // config de teste montada à mão: nada a baixar
      if (fila[0] === courseId) deNovo.add(courseId);
      else if (!fila.includes(courseId)) fila.push(courseId);
      const e = estados.get(courseId);
      if (e) Object.assign(e, { ativo: true, erro: null });
      else estados.set(courseId, { ativo: true, erro: null });
      // Começa no próximo tique: se o laço rodasse já aqui, um pedido feito de dentro
      // dele (antes de `rodando` ser atribuído) abriria um segundo laço em paralelo,
      // e os dois escreveriam o mesmo arquivo.
      if (!rodando) rodando = Promise.resolve().then(laco).finally(() => { rodando = null; });
    },
    estado(courseId) {
      return estados.get(courseId) ?? { ativo: false, erro: null };
    },
    retomarTodos() {
      const ids = db.prepare("SELECT id FROM courses WHERE source='drive' AND archived=0 ORDER BY created_at").all() as Array<{ id: string }>;
      for (const { id } of ids) baixador.enfileirar(id);
    },
    async aguardar() {
      while (rodando) await rodando;
    },
  };
  return baixador;
}
