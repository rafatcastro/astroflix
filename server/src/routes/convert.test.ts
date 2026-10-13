import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDb } from '../db/index';
import { createCourseFromPath } from '../scan/scan-course';
import { buildApp } from '../app';
import { hasFfmpeg } from '../media/ffmpeg';
import { semearCursoDrive } from '../drive/teste-helpers';

function makeTsDisfarcadoDeMp4(dir: string, name: string): string {
  const f = path.join(dir, name);
  spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', '-y', f], { stdio: 'ignore' });
  return f;
}

describe('verificação e conversão de reprodução (pulado sem ffmpeg)', () => {
  it.skipIf(!hasFfmpeg())('TS renomeado: verify marca não-tocável; convert remuxa; stream passa a servir o convertido', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-'));
    makeTsDisfarcadoDeMp4(root, 'aula.mp4');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convD-'));
    const convertedDir = path.join(dataDir, 'converted');
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(cid) as any).id;
    const app = buildApp({ allowedRoots: [os.tmpdir()], thumbsDir: path.join(dataDir, 'thumbs'), convertedDir } as any, db);

    // verify: detecta que o "mp4" é TS e corrige o flag
    const ver = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/verify-playback` });
    expect(ver.statusCode).toBe(200);
    expect(ver.json()).toMatchObject({ playable: false, reason: 'container', remuxable: true });
    expect((db.prepare('SELECT playable FROM lessons WHERE id=?').get(lid) as any).playable).toBe(0);

    // convert: remuxa sem recodificar e reabilita a aula
    const conv = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/convert` });
    expect(conv.statusCode).toBe(200);
    expect(conv.json()).toMatchObject({ status: 'converted' });
    expect(fs.existsSync(path.join(convertedDir, `${lid}.mp4`))).toBe(true);
    expect((db.prepare('SELECT playable FROM lessons WHERE id=?').get(lid) as any).playable).toBe(1);

    // stream: serve o convertido (mp4 de verdade, começa com ftyp)
    const st = await app.inject({ method: 'GET', url: `/api/lessons/${lid}/stream`, headers: { range: 'bytes=0-15' } });
    expect(st.statusCode).toBe(206);
    expect(st.rawPayload.subarray(4, 8).toString('latin1')).toBe('ftyp');

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it.skipIf(!hasFfmpeg())('H.264 10-bit: convert recodifica em segundo plano, com progresso, e a aula passa a tocar', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
    const f = path.join(root, 'aula.mp4');
    // Container e codec certos, mas nenhum player decodifica 10-bit: só recodificando.
    spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-y', f], { stdio: 'ignore' });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcD-'));
    const convertedDir = path.join(dataDir, 'converted');
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(cid) as any).id;
    const app = buildApp({ allowedRoots: [os.tmpdir()], thumbsDir: path.join(dataDir, 't'), convertedDir } as any, db);

    const res = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/convert` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'transcoding' });

    let estado: any;
    for (let i = 0; i < 300; i++) {
      estado = (await app.inject({ method: 'GET', url: `/api/lessons/${lid}/convert` })).json();
      if (estado.status !== 'transcoding') break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    expect(estado).toEqual({ status: 'converted' });
    expect(fs.existsSync(path.join(convertedDir, `${lid}.mp4`))).toBe(true);
    expect(fs.existsSync(path.join(convertedDir, `${lid}.parcial.mp4`))).toBe(false);
    expect((db.prepare('SELECT playable FROM lessons WHERE id=?').get(lid) as any).playable).toBe(1);
    const ver = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/verify-playback` });
    expect(ver.json()).toEqual({ playable: true });

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    db.close();
  }, 60000);

  // O WebKit (janela do macOS) toca HEVC, mas só com a marca hvc1.
  it.skipIf(!hasFfmpeg())('HEVC: tocável quando a janela toca HEVC; hev1 vira hvc1 com remux sem perda', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hevc-'));
    spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10', '-c:v', 'libx265', '-tag:v', 'hev1', '-y', path.join(root, 'aula.mp4')], { stdio: 'ignore' });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hevcD-'));
    const convertedDir = path.join(dataDir, 'converted');
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(cid) as any).id;
    const app = buildApp({ allowedRoots: [os.tmpdir()], thumbsDir: path.join(dataDir, 't'), convertedDir } as any, db);

    const semHevc = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/verify-playback` });
    expect(semHevc.json()).toMatchObject({ playable: false, reason: 'codec', remuxable: false });
    const comHevc = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/verify-playback?hevc=1` });
    expect(comHevc.json()).toMatchObject({ playable: false, reason: 'container', remuxable: true });

    const conv = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/convert?hevc=1` });
    expect(conv.json()).toEqual({ status: 'converted' });
    const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_tag_string', '-of', 'csv=p=0', path.join(convertedDir, `${lid}.mp4`)]);
    expect(String(out.stdout).trim()).toBe('hvc1');

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    db.close();
  }, 60000);
});

describe('verificação e conversão — curso do Drive (não depende de ffmpeg)', () => {
  it('convert drive → 409', async () => {
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const app = buildApp({ allowedRoots: [], thumbsDir: '/x', convertedDir: '/y' } as any, db);
    const r = await app.inject({ method: 'POST', url: '/api/lessons/ld/convert' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'curso-do-drive' });
  });

  it('verify-playback drive usa o flag guardado', async () => {
    const db = openDb(':memory:');
    semearCursoDrive(db);
    const app = buildApp({ allowedRoots: [], thumbsDir: '/x', convertedDir: '/y' } as any, db);
    const ok = await app.inject({ method: 'POST', url: '/api/lessons/ld/verify-playback' });
    expect(ok.json()).toEqual({ playable: true, reason: null, remuxable: false, semArquivo: true });
    db.prepare("UPDATE lessons SET playable=0 WHERE id='ld'").run();
    const no = await app.inject({ method: 'POST', url: '/api/lessons/ld/verify-playback' });
    expect(no.json()).toEqual({ playable: false, reason: 'formato', remuxable: false, semArquivo: true });
  });
});
