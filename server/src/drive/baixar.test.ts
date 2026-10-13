import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { buildApp } from '../app';
import { criarBaixador } from './baixar';
import { spawnSync } from 'node:child_process';
import { hasFfmpeg } from '../media/ffmpeg';
import { arquivoBaixadoDaAula, arquivoBaixadoDoMaterial } from './local';
import type { ClienteDrive } from './api';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'baixar-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Conteúdo de cada arquivo no "Drive". Não é vídeo de verdade: o ffprobe não
// reconhece, então nada é convertido e o teste fica só no download.
const ARQUIVOS: Record<string, string> = {
  'v-1': 'primeira aula....',
  'v-2': 'segunda aula, mais longa',
  'pdf': '%PDF apostila',
};

function montar() {
  const config = loadConfig({ DATA_DIR: fs.mkdtempSync(path.join(tmp, 'dados-')) });
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO courses (id, title, root_path, structure, created_at, updated_at, source, drive_folder_id)
     VALUES ('c1', 'Curso', 'l', 'flat', 'x', 'x', 'drive', 'pasta')`,
  ).run();
  const aula = db.prepare(
    `INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, remote_id)
     VALUES (?, 'c1', ?, ?, ?, 0, ?, 1, 'mp4', 1, ?)`,
  );
  aula.run('a2', '02 - b.mp4', 'B', 1, ARQUIVOS['v-2'].length, 'v-2');
  aula.run('a1', '01 - a.mp4', 'A', 0, ARQUIVOS['v-1'].length, 'v-1');
  db.prepare(
    `INSERT INTO materials (id, course_id, rel_path, kind, size_bytes, remote_id) VALUES ('m1', 'c1', 'apostila.pdf', 'pdf', ?, 'pdf')`,
  ).run(ARQUIVOS.pdf.length);

  const pedidos: Array<{ id: string; range?: string }> = [];
  let antes: ((id: string) => Promise<void> | void) | null = null;
  const cliente = {
    async baixar(id: string, range?: string) {
      pedidos.push({ id, range });
      await antes?.(id);
      const dado = Buffer.from(ARQUIVOS[id], 'latin1');
      const m = range && /^bytes=(\d+)-$/.exec(range);
      if (m) return new Response(dado.subarray(Number(m[1])), { status: 206 });
      return new Response(dado, { status: 200 });
    },
  } as unknown as ClienteDrive;
  const baixador = criarBaixador({ db, config, cliente: () => cliente });
  return { config, db, baixador, pedidos, aoBaixar: (f: typeof antes) => { antes = f; } };
}

const ler = (p: string) => fs.readFileSync(p, 'utf8');

describe('download dos cursos do Drive', () => {
  it('abrir uma aula baixa ela e as próximas, na ordem; materiais ficam no Drive', async () => {
    const { config, baixador, pedidos } = montar();
    baixador.pedirAula('a1');
    expect(baixador.estado('c1')).toEqual({ ativo: true, erro: null });
    await baixador.aguardar();

    expect(pedidos.map((p) => p.id)).toEqual(['v-1', 'v-2']);
    expect(ler(arquivoBaixadoDaAula(config, 'c1', 'a1', '01 - a.mp4'))).toBe(ARQUIVOS['v-1']);
    expect(ler(arquivoBaixadoDaAula(config, 'c1', 'a2', '02 - b.mp4'))).toBe(ARQUIVOS['v-2']);
    expect(fs.existsSync(arquivoBaixadoDoMaterial(config, 'c1', 'm1', 'apostila.pdf'))).toBe(false);
    expect(baixador.estado('c1')).toEqual({ ativo: false, erro: null });

    // De novo: o que já está no disco não é baixado outra vez.
    baixador.pedirAula('a1');
    await baixador.aguardar();
    expect(pedidos).toHaveLength(2);
  });

  // Um curso de 40 GB baixado inteiro ao colar o link tomou a internet da casa.
  it('nunca baixa o curso inteiro: só a janela da aula aberta, e nada ao abrir o app', async () => {
    const { db, baixador, pedidos } = montar();
    const aula = db.prepare(
      `INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, remote_id)
       VALUES (?, 'c1', ?, ?, ?, 0, 1, 1, 'mp4', 1, ?)`,
    );
    for (let i = 3; i <= 6; i++) {
      ARQUIVOS[`v-${i}`] = 'x';
      aula.run(`a${i}`, `0${i}.mp4`, `Aula ${i}`, i - 1, `v-${i}`);
    }
    db.prepare("INSERT INTO progress (lesson_id, position_sec, furthest_sec, completed, updated_at) VALUES ('a4', 0, 0, 1, 'x')").run();

    baixador.retomarTodos();
    baixador.enfileirar('c1');
    await baixador.aguardar();
    expect(pedidos).toEqual([]);

    // A concluída (a4) não conta na janela: a3 aberta → a3, a5, a6.
    baixador.pedirAula('a3');
    await baixador.aguardar();
    expect(pedidos.map((p) => p.id)).toEqual(['v-3', 'v-5', 'v-6']);
  });

  it('retoma o arquivo pela metade com Range em vez de começar do zero', async () => {
    const { config, baixador, pedidos } = montar();
    const destino = arquivoBaixadoDaAula(config, 'c1', 'a1', '01 - a.mp4');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(`${destino}.part`, ARQUIVOS['v-1'].slice(0, 5));

    baixador.pedirAula('a1');
    await baixador.aguardar();

    expect(pedidos[0]).toEqual({ id: 'v-1', range: 'bytes=5-' });
    expect(ler(destino)).toBe(ARQUIVOS['v-1']);
    expect(fs.existsSync(`${destino}.part`)).toBe(false);
  });

  // Arquivo truncado tocaria até o meio e pararia: não pode virar "baixado".
  it('tamanho diferente do Drive não conta como baixado e o erro fica no estado', async () => {
    const { config, db, baixador } = montar();
    db.prepare("UPDATE lessons SET size_bytes=999 WHERE id='a1'").run();

    baixador.pedirAula('a1');
    await baixador.aguardar();

    expect(fs.existsSync(arquivoBaixadoDaAula(config, 'c1', 'a1', '01 - a.mp4'))).toBe(false);
    expect(baixador.estado('c1')).toEqual({ ativo: false, erro: 'sem-conexao' });
  });

  it('curso excluído no meio para o download', async () => {
    const { config, db, baixador, pedidos, aoBaixar } = montar();
    aoBaixar((id) => {
      if (id === 'v-1') db.prepare("DELETE FROM courses WHERE id='c1'").run();
    });

    baixador.pedirAula('a1');
    await baixador.aguardar();

    expect(pedidos.map((p) => p.id)).toEqual(['v-1']);
    expect(fs.existsSync(arquivoBaixadoDaAula(config, 'c1', 'a2', '02 - b.mp4'))).toBe(false);
  });

  // Re-escanear enquanto baixa traz aula nova, e a pessoa abre a aula de novo: ela entra na mesma leva.
  it('pedido de novo durante o download roda mais uma volta no fim', async () => {
    const { config, db, baixador, aoBaixar } = montar();
    aoBaixar((id) => {
      if (id !== 'v-1') return;
      aoBaixar(null);
      ARQUIVOS['v-3'] = 'terceira';
      db.prepare(
        `INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable, remote_id)
         VALUES ('a3', 'c1', '03 - c.mp4', 'C', 2, 0, 8, 1, 'mp4', 1, 'v-3')`,
      ).run();
      baixador.pedirAula('a1');
    });

    baixador.pedirAula('a1');
    await baixador.aguardar();

    expect(ler(arquivoBaixadoDaAula(config, 'c1', 'a3', '03 - c.mp4'))).toBe('terceira');
    expect(baixador.estado('c1').ativo).toBe(false);
  });

  it('aula baixada toca do disco, sem passar pelo Drive', async () => {
    const { config, db, baixador } = montar();
    baixador.pedirAula('a1');
    await baixador.aguardar();

    // fetch que explode: se o stream fosse ao Google, o teste falharia.
    const app = buildApp(config, db, { fetch: (async () => { throw new Error('não devia ir à rede'); }) as unknown as typeof fetch });
    const r = await app.inject({ method: 'GET', url: '/api/lessons/a1/stream', headers: { range: 'bytes=0-4' } });
    expect(r.statusCode).toBe(206);
    expect(r.body).toBe(ARQUIVOS['v-1'].slice(0, 5));

    const curso = (await app.inject({ method: 'GET', url: '/api/courses/c1' })).json();
    expect(curso.download).toEqual({ total: 2, baixadas: 2, ativo: false, erro: null });

    // Excluir o curso apaga as cópias.
    await app.inject({ method: 'DELETE', url: '/api/courses/c1' });
    expect(fs.existsSync(path.join(config.downloadsDir, 'c1'))).toBe(false);
  });

  it('aula concluída sai do disco e não é baixada de novo; a assistida por último fica', async () => {
    const { config, db, baixador, pedidos } = montar();
    baixador.pedirAula('a1');
    await baixador.aguardar();
    const a1 = arquivoBaixadoDaAula(config, 'c1', 'a1', '01 - a.mp4');
    const a2 = arquivoBaixadoDaAula(config, 'c1', 'a2', '02 - b.mp4');
    const convertidoA1 = path.join(config.convertedDir, 'a1.mp4');
    fs.mkdirSync(config.convertedDir, { recursive: true });
    fs.writeFileSync(convertidoA1, 'convertido');

    const progresso = db.prepare(
      'INSERT INTO progress (lesson_id, position_sec, furthest_sec, completed, updated_at) VALUES (?, 0, 0, 1, ?)',
    );
    progresso.run('a1', '2026-01-01');
    progresso.run('a2', '2026-01-02'); // ainda tocando os minutos finais
    baixador.enfileirar('c1');
    await baixador.aguardar();

    expect(fs.existsSync(a1)).toBe(false);
    expect(fs.existsSync(convertidoA1)).toBe(false);
    expect(fs.existsSync(a2)).toBe(true);
    // Os metadados ficam: a aula e o progresso.
    expect(db.prepare("SELECT title FROM lessons WHERE id='a1'").get()).toEqual({ title: 'A' });
    expect(db.prepare("SELECT completed FROM progress WHERE lesson_id='a1'").get()).toEqual({ completed: 1 });
    expect(pedidos).toHaveLength(2);

    const app = buildApp(config, db);
    const curso = (await app.inject({ method: 'GET', url: '/api/courses/c1' })).json();
    expect(curso.download).toMatchObject({ total: 2, baixadas: 2 });
  });

  it('concluir uma aula do Drive pela API apaga a cópia dela', async () => {
    const { config, db } = montar();
    // fetch que falha: o que importa aqui é a limpeza, que vem antes de qualquer download.
    const app = buildApp(config, db, { fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    const a1 = arquivoBaixadoDaAula(config, 'c1', 'a1', '01 - a.mp4');
    fs.mkdirSync(path.dirname(a1), { recursive: true });
    fs.writeFileSync(a1, ARQUIVOS['v-1']);
    db.prepare("INSERT INTO progress (lesson_id, position_sec, furthest_sec, completed, updated_at) VALUES ('a2', 0, 0, 0, '2999-01-01')").run();

    const r = await app.inject({ method: 'POST', url: '/api/lessons/a1/complete', payload: { completed: true } });
    expect(r.statusCode).toBe(204);
    await vi.waitFor(() => expect(fs.existsSync(a1)).toBe(false));
  });

  it('abrir a aula pela API é o que dispara o download dela', async () => {
    const { config, db } = montar();
    const app = buildApp(config, db, { fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    const curso = async () => (await app.inject({ method: 'GET', url: '/api/courses/c1' })).json().download;
    expect(await curso()).toMatchObject({ ativo: false, erro: null });
    await app.inject({ method: 'GET', url: '/api/lessons/a2' });
    // Offline: a tentativa acontece e para com erro, sem derrubar a aula.
    await vi.waitFor(async () => expect((await curso()).erro).not.toBeNull());
  });

  // MPEG-TS com cara de .mp4 é comum em curso baixado: chega já convertido.
  it.skipIf(!hasFfmpeg())('vídeo que não toca é convertido depois de baixar, e a cópia baixada sai', async () => {
    const ts = path.join(tmp, 'aula.ts');
    spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mpegts', '-y', ts], { stdio: 'ignore' });
    const { config, db, baixador } = montar();
    ARQUIVOS['v-1'] = fs.readFileSync(ts, 'latin1');
    db.prepare("UPDATE lessons SET size_bytes=? WHERE id='a1'").run(fs.statSync(ts).size);
    try {
      baixador.pedirAula('a1');
      await baixador.aguardar();
    } finally {
      ARQUIVOS['v-1'] = 'primeira aula....';
    }

    expect(fs.existsSync(path.join(config.convertedDir, 'a1.mp4'))).toBe(true);
    expect(fs.existsSync(arquivoBaixadoDaAula(config, 'c1', 'a1', '01 - a.mp4'))).toBe(false);
  }, 60000);
});
