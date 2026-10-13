import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db/index';
import { loadConfig } from '../config';
import { aguardarCapasTelegram, createCourseFromTelegram, reconcileTelegramCourse } from './scan-telegram';
import type { ClienteTelegram, GrupoTelegram } from '../telegram/cliente';
import { FalhaTelegram, type MensagemTelegram } from '../telegram/tipos';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-tg-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GRUPO: GrupoTelegram = { peer: { tipo: 'canal', id: '777', accessHash: '999' }, titulo: 'Curso de Inglês' };
const video = (id: number, legenda: string): MensagemTelegram => ({
  id,
  data: 1_700_000_000 + id,
  legenda,
  midia: { tipo: 'video', nome: `v${id}.mp4`, tamanho: 100, mime: 'video/mp4', duracaoSec: 30, temMiniatura: true },
});

function montar(mensagens: MensagemTelegram[]) {
  const dir = fs.mkdtempSync(path.join(tmp, 'd-'));
  const config = loadConfig({ DATA_DIR: dir });
  fs.mkdirSync(config.thumbsDir, { recursive: true });
  const db = openDb(path.join(dir, 'app.db'));
  const estado = { mensagens };
  const cliente = {
    mensagens: async () => estado.mensagens,
    miniatura: async () => Buffer.from('jpg'),
  } as unknown as ClienteTelegram;
  return { db, config, estado, deps: { cliente, config } };
}

describe('createCourseFromTelegram', () => {
  it('cria o curso na ordem de postagem, com título da legenda e capa do Telegram', async () => {
    const { db, deps } = montar([video(20, 'Aula 2'), video(10, 'Aula 1'), { id: 15, data: 1, legenda: 'oi', midia: null }]);
    const { id, existente } = await createCourseFromTelegram(db, deps, GRUPO, 'https://t.me/ingles');
    expect(existente).toBe(false);
    const c = db.prepare('SELECT title, source, telegram_peer, root_path FROM courses WHERE id=?').get(id) as any;
    expect(c).toMatchObject({ title: 'Curso de Inglês', source: 'telegram', root_path: 'https://t.me/ingles' });
    expect(JSON.parse(c.telegram_peer)).toEqual(GRUPO.peer);
    const aulas = db.prepare('SELECT title, remote_id, duration_sec FROM lessons WHERE course_id=? ORDER BY order_index').all(id);
    expect(aulas).toEqual([
      { title: 'Aula 1', remote_id: '10', duration_sec: 30 },
      { title: 'Aula 2', remote_id: '20', duration_sec: 30 },
    ]);
    await aguardarCapasTelegram();
    const capas = db.prepare('SELECT thumb_path FROM lessons WHERE course_id=?').all(id) as Array<{ thumb_path: string | null }>;
    expect(capas.every((a) => a.thumb_path && fs.existsSync(a.thumb_path))).toBe(true);
  });

  it('grupo sem vídeo nenhum → sem-videos, e nenhum curso é criado', async () => {
    const { db, deps } = montar([{ id: 1, data: 1, legenda: 'só conversa', midia: null }]);
    await expect(createCourseFromTelegram(db, deps, GRUPO, 'x')).rejects.toEqual(new FalhaTelegram('sem-videos'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM courses').get()).toEqual({ n: 0 });
  });

  it('o mesmo grupo de novo não duplica: reconcilia o existente', async () => {
    const { db, deps, estado } = montar([video(10, 'Aula 1')]);
    const a = await createCourseFromTelegram(db, deps, GRUPO, 'x');
    estado.mensagens = [video(10, 'Aula 1'), video(30, 'Aula 3')];
    const b = await createCourseFromTelegram(db, deps, GRUPO, 'x');
    expect(b).toEqual({ id: a.id, existente: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id=?').get(a.id)).toEqual({ n: 2 });
  });
});

describe('reconcileTelegramCourse', () => {
  it('aula apagada do grupo fica marcada como sumida, com o progresso intacto', async () => {
    const { db, deps, estado } = montar([video(10, 'Aula 1'), video(20, 'Aula 2')]);
    const { id } = await createCourseFromTelegram(db, deps, GRUPO, 'x');
    const l1 = (db.prepare("SELECT id FROM lessons WHERE remote_id='10'").get() as { id: string }).id;
    db.prepare("INSERT INTO progress (lesson_id, position_sec, furthest_sec, updated_at) VALUES (?, 12, 12, 'x')").run(l1);
    estado.mensagens = [video(20, 'Aula 2')];
    const r = await reconcileTelegramCourse(db, deps, id);
    expect(r.missing).toBe(1);
    expect(db.prepare('SELECT missing FROM lessons WHERE id=?').get(l1)).toEqual({ missing: 1 });
    expect(db.prepare('SELECT position_sec FROM progress WHERE lesson_id=?').get(l1)).toEqual({ position_sec: 12 });
  });
});
