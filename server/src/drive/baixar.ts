import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { Capacidades } from '../media/ffmpeg';
import { prepararParaTocar } from '../media/preparar';
import type { ClienteDrive } from './api';
import { arquivoBaixadoDaAula, arquivoBaixadoDoMaterial, arquivoLocalDaAula } from './local';
import { resourceKeyDoCurso } from './status';
import { FalhaDrive } from './tipos';

// Todo curso do Drive é baixado para DATA_DIR/downloads e, se preciso, convertido
// para tocar. Assistir pela rede dependia da cota do Google (que bloqueia pastas
// muito acessadas), de conexão boa e do seek ir e voltar ao Drive; com o arquivo
// local, o player é o mesmo dos cursos do disco. Enquanto uma aula não chega, ela
// continua tocando direto do Drive, então nada espera o curso inteiro.

export interface EstadoDownload {
  /** Ainda baixando ou convertendo alguma aula deste curso. */
  ativo: boolean;
  /** Motivo da última parada (tipo de FalhaDrive, 'sem-espaco'), ou null. */
  erro: string | null;
}

export interface Baixador {
  /** Põe o curso na fila (idempotente). Chamado ao colar o link, ao re-escanear e ao abrir o app. */
  enfileirar(courseId: string): void;
  estado(courseId: string): EstadoDownload;
  /** Retoma todos os cursos do Drive, com o que faltar de cada um. */
  retomarTodos(): void;
  /** Para os testes: espera a fila esvaziar. */
  aguardar(): Promise<void>;
}

const CHAVE_HEVC = 'player.hevc';

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

    for (const a of aulas) {
      if (!existe(courseId)) return; // excluído no meio: não baixa mais nada
      if (arquivoLocalDaAula(config, courseId, a.id, a.rel_path)) continue;
      const destino = arquivoBaixadoDaAula(config, courseId, a.id, a.rel_path);
      await baixarArquivo(cliente, a.remote_id, destino, Number(a.size_bytes ?? 0));
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

    const materiais = db
      .prepare('SELECT id, rel_path, remote_id, size_bytes FROM materials WHERE course_id=? AND remote_id IS NOT NULL ORDER BY rel_path')
      .all(courseId) as Array<{ id: string; rel_path: string; remote_id: string; size_bytes: number | null }>;
    for (const m of materiais) {
      if (!existe(courseId)) return;
      const destino = arquivoBaixadoDoMaterial(config, courseId, m.id, m.rel_path);
      if (fs.existsSync(destino)) continue;
      await baixarArquivo(cliente, m.remote_id, destino, Number(m.size_bytes ?? 0));
    }
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
