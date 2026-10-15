import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db';
import { loadConfig } from '../config';
import { buildApp } from '../app';
import { salvarCredenciais } from '../drive/credenciais';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-drive-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PASTA = 'application/vnd.google-apps.folder';
const PDF = 'application/pdf';
const RAIZ = 'pasta-livros-1234';
const SUB = 'subpasta-questoes-1234';
const CONTEUDO = '%PDF-1.4 conteudo do drive';

const arq = (id: string, name: string, mimeType: string, extra: object = {}) => ({ id, name, mimeType, size: '26', ...extra });

// Um Drive de mentira: a pasta tem um PDF, um vídeo, um atalho para outro PDF e
// uma subpasta com mais um PDF (e um atalho de volta para a raiz, que não pode
// virar laço). Os ids "privado…" respondem 404, como o Drive faz sem acesso.
function fetchFalso(chamadas: Array<{ url: string; range: string | null; chaves: string | null }> = []): typeof fetch {
  const arquivos: Record<string, object> = {
    [RAIZ]: arq(RAIZ, 'Livros', PASTA),
    [SUB]: arq(SUB, 'Questões', PASTA),
    'pdf-calculo-1234': arq('pdf-calculo-1234', 'Cálculo_I.pdf', PDF),
    'pdf-enem-12345': arq('pdf-enem-12345', 'ENEM 2024.pdf', PDF, { resourceKey: '0-xyz' }),
    'pdf-alvo-12345': arq('pdf-alvo-12345', 'Alvo.pdf', PDF),
    'video-1234567': arq('video-1234567', 'aula.mp4', 'video/mp4'),
  };
  const filhos: Record<string, object[]> = {
    [RAIZ]: [
      arquivos['pdf-calculo-1234'],
      arq('video-1234567', 'aula.mp4', 'video/mp4'),
      arq('atalho-123456', 'Atalho para Física.pdf', 'application/vnd.google-apps.shortcut', {
        shortcutDetails: { targetId: 'pdf-alvo-12345', targetMimeType: PDF },
      }),
      arquivos[SUB],
    ],
    [SUB]: [
      arquivos['pdf-enem-12345'],
      arq('atalho-volta-1', 'Volta', 'application/vnd.google-apps.shortcut', { shortcutDetails: { targetId: RAIZ, targetMimeType: PASTA } }),
    ],
  };
  return (async (input: any, init?: RequestInit) => {
    const u = new URL(String(input));
    const h = new Headers(init?.headers);
    chamadas.push({ url: u.toString(), range: h.get('range'), chaves: h.get('x-goog-drive-resource-keys') });
    if (u.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'tok', expires_in: 3600 });
    const m = /\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const a = arquivos[m[1]];
      if (!a) return new Response('{}', { status: 404 });
      if (u.searchParams.get('alt') === 'media') {
        return new Response(CONTEUDO.slice(0, 5), { status: 206, headers: { 'content-range': `bytes 0-4/${CONTEUDO.length}`, 'content-length': '5' } });
      }
      return Response.json(a);
    }
    if (u.pathname.endsWith('/files')) {
      const pai = /'([^']+)' in parents/.exec(u.searchParams.get('q') ?? '')?.[1] ?? '';
      return Response.json({ files: filhos[pai] ?? [] });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

function montar(f: typeof fetch = fetchFalso()) {
  const db = openDb(':memory:');
  const config = loadConfig({ DATA_DIR: path.join(tmp, 'd' + Math.random().toString(36).slice(2)) });
  const app = buildApp(config, db, { fetch: f, supabase: null });
  const post = (payload: object, host = 'localhost:7777') =>
    app.inject({ method: 'POST', url: '/api/documentos/drive', payload, headers: { host } });
  return { app, db, post };
}

describe('PDFs do Google Drive', () => {
  it('pasta: todos os PDFs dela, subpastas e atalhos inclusive, sem laço e sem duplicar', async () => {
    const { app, post } = montar();
    const r = await post({ link: `https://drive.google.com/drive/folders/${RAIZ}`, tipo: 'Livros' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ criados: 3, jaExistiam: 0 });
    const lista = (await app.inject({ method: 'GET', url: '/api/documentos' })).json();
    expect(lista.map((d: any) => d.titulo).sort()).toEqual(['Atalho para Física', 'Cálculo I', 'ENEM 2024']);
    expect(lista[0]).toMatchObject({ origem: 'drive', disponivel: true, tipo: 'Livros', caminho: '' });
    expect((await post({ link: RAIZ })).json()).toMatchObject({ criados: 0, jaExistiam: 3 });
  });

  it('link de um arquivo: só ele; e um link que não é PDF nem pasta é recusado', async () => {
    const { post } = montar();
    expect((await post({ link: 'https://drive.google.com/file/d/pdf-calculo-1234/view?usp=sharing' })).json()).toMatchObject({ criados: 1 });
    expect((await post({ link: 'https://drive.google.com/file/d/video-1234567/view' })).json()).toEqual({ error: 'nao-e-pdf' });
    expect((await post({ link: 'https://exemplo.com/x.pdf' })).json()).toEqual({ error: 'link-invalido' });
  });

  it('o arquivo vem do Drive com o Range e a resource key do link', async () => {
    const chamadas: Array<{ url: string; range: string | null; chaves: string | null }> = [];
    const { app, db, post } = montar(fetchFalso(chamadas));
    await post({ link: `https://drive.google.com/drive/folders/${RAIZ}` });
    const enem = db.prepare("SELECT id FROM documentos WHERE drive_id='pdf-enem-12345'").get() as { id: string };
    const r = await app.inject({ method: 'GET', url: `/api/documentos/${enem.id}/arquivo`, headers: { range: 'bytes=0-4' } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body).toBe('%PDF-');
    const media = chamadas.find((c) => c.url.includes('pdf-enem-12345') && c.url.includes('alt=media'))!;
    expect(media.range).toBe('bytes=0-4');
    expect(media.chaves).toBe('pdf-enem-12345/0-xyz');
  });

  it('pasta privada sem conta Google: pede o login, como o curso do Drive', async () => {
    const { db, post } = montar();
    salvarCredenciais(db, { clientId: 'cid' });
    const r = await post({ link: 'https://drive.google.com/drive/folders/privado-0123456789' }, '127.0.0.1:9999');
    expect(r.statusCode).toBe(401);
    expect(r.json().precisaAutorizar).toBe(true);
  });
});
