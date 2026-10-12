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

  it.skipIf(!hasFfmpeg())('o que não dá para remuxar responde 409 e não gera arquivo pela metade', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
    const f = path.join(root, 'aula.mp4');
    // H.264 10-bit: container e codec certos, mas o navegador não decodifica.
    // Só recodificando resolveria — e recodificar está fora do escopo do app.
    spawnSync('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-y', f], { stdio: 'ignore' });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcD-'));
    const convertedDir = path.join(dataDir, 'converted');
    const db = openDb(':memory:');
    const cid = createCourseFromPath(db, root);
    const lid = (db.prepare('SELECT id FROM lessons WHERE course_id=?').get(cid) as any).id;
    const app = buildApp({ allowedRoots: [os.tmpdir()], thumbsDir: path.join(dataDir, 't'), convertedDir } as any, db);

    const res = await app.inject({ method: 'POST', url: `/api/lessons/${lid}/convert` });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('transcode_required');
    expect(fs.existsSync(path.join(convertedDir, `${lid}.mp4`))).toBe(false);
    // o flag continua refletindo a realidade: a aula não toca
    expect((db.prepare('SELECT playable FROM lessons WHERE id=?').get(lid) as any).playable).toBe(0);

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    db.close();
  }, 30000);
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
    expect(ok.json()).toEqual({ playable: true, reason: null, remuxable: false });
    db.prepare("UPDATE lessons SET playable=0 WHERE id='ld'").run();
    const no = await app.inject({ method: 'POST', url: '/api/lessons/ld/verify-playback' });
    expect(no.json()).toEqual({ playable: false, reason: 'formato', remuxable: false });
  });
});
