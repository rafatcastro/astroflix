import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db';
import { loadConfig } from '../config';
import { buildApp } from '../app';
import { createCourseFromPath } from '../scan/scan-course';
import { supabaseFalso } from '../nuvem/supabase-falso';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conta-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// O Google de mentira: o code "c-<pessoa>" vira o id_token "id-<pessoa>".
const googleFalso = (async (url: string, init?: RequestInit) => {
  if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
    const code = new URLSearchParams(String(init?.body)).get('code') ?? '';
    return Response.json({ id_token: code.replace(/^c-/, 'id-'), access_token: 'x' });
  }
  throw new Error(`rede inesperada: ${url}`);
}) as unknown as typeof fetch;

type Nuvem = ReturnType<typeof supabaseFalso>;
const H = { host: 'localhost:7777' };

/** Um computador: banco próprio, a mesma nuvem. */
function maquina(nuvem: Nuvem) {
  const dir = fs.mkdtempSync(path.join(tmp, 'm-'));
  const config = loadConfig({ DATA_DIR: dir, ALLOWED_ROOTS: tmp });
  const db = openDb(path.join(dir, 'app.db'));
  db.prepare("INSERT INTO settings (key, value) VALUES ('drive.credenciais', ?)").run(JSON.stringify({ clientId: 'cid' }));
  const app = buildApp(config, db, { supabase: nuvem.cliente, fetch: googleFalso, exigirConta: true });
  const get = async (url: string) => app.inject({ method: 'GET', url, headers: H });
  const post = async (url: string, payload?: unknown) => app.inject({ method: 'POST', url, payload: payload as any, headers: H });
  async function entrar(pessoa: string) {
    const { url } = (await post('/api/conta/login')).json();
    const state = new URL(url).searchParams.get('state');
    await get(`/api/conta/callback?code=c-${pessoa}&state=${state}`);
    expect((await get(`/api/conta/login/resultado?state=${state}`)).json()).toEqual({ pronto: true, ok: true });
    await post('/api/conta/sincronizar');
  }
  return { db, app, get, post, entrar, sincronizar: () => post('/api/conta/sincronizar') };
}

function cursoNoDisco(nome: string): string {
  const raiz = path.join(tmp, nome);
  fs.mkdirSync(path.join(raiz, 'M1'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'M1', '01 a.mp4'), 'x');
  fs.writeFileSync(path.join(raiz, 'M1', '02 b.mp4'), 'x');
  return raiz;
}

describe('conta e nuvem', () => {
  it('sem entrar, nada de dados responde; a conta, sim', async () => {
    const m = maquina(supabaseFalso());
    expect((await m.get('/api/courses')).statusCode).toBe(401);
    expect((await m.get('/api/courses')).json()).toEqual({ error: 'precisa-entrar' });
    expect((await m.get('/api/conta')).json()).toMatchObject({ configurada: true, entrou: false });
    await m.entrar('ana');
    expect((await m.get('/api/courses')).statusCode).toBe(200);
    expect((await m.get('/api/conta')).json()).toMatchObject({ entrou: true, email: 'ana@exemplo.com' });
  });

  it('login com state desconhecido não entra', async () => {
    const m = maquina(supabaseFalso());
    await m.get('/api/conta/callback?code=c-ana&state=inventado');
    expect((await m.get('/api/conta')).json()).toMatchObject({ entrou: false });
  });

  it('primeira entrada sobe a biblioteca que já existia; outra máquina recebe tudo', async () => {
    const nuvem = supabaseFalso();
    const a = maquina(nuvem);
    const raiz = cursoNoDisco('curso-a');
    const cursoId = createCourseFromPath(a.db, raiz);
    const aula = a.db.prepare('SELECT id FROM lessons WHERE course_id=? ORDER BY order_index').get(cursoId) as { id: string };
    a.db.prepare("INSERT INTO collections (id, name, created_at) VALUES ('col', 'Programação', 'x')").run();
    a.db.prepare("UPDATE courses SET collection_id='col' WHERE id=?").run(cursoId);
    a.db.prepare("INSERT INTO progress (lesson_id, position_sec, furthest_sec, updated_at) VALUES (?, 30, 40, '2030-01-01T00:00:00.000Z')").run(aula.id);
    a.db.prepare("INSERT INTO flashcards (id, course_id, lesson_id, frente, verso, anki_note_id, criado_em, atualizado_em) VALUES ('f1', ?, ?, 'F', 'V', 77, 'x', 'x')").run(cursoId, aula.id);

    await a.entrar('ana');
    expect(nuvem.linhas('cursos')).toHaveLength(1);
    expect(nuvem.linhas('aulas')).toHaveLength(2);
    expect(nuvem.linhas('pastas_por_maquina')[0]).toMatchObject({ curso_id: cursoId, caminho: raiz });

    const b = maquina(nuvem);
    await b.entrar('ana');
    const curso = (await b.get(`/api/courses/${cursoId}`)).json();
    expect(curso).toMatchObject({ title: 'curso-a', collectionId: 'col', totalLessons: 2 });
    const aulaB = b.db.prepare("SELECT l.id, p.furthest_sec FROM lessons l JOIN progress p ON p.lesson_id = l.id WHERE l.rel_path='M1/01 a.mp4'").get() as any;
    expect(aulaB.furthest_sec).toBe(40);
    expect(b.db.prepare('SELECT frente, lesson_id, pendente, anki_note_id FROM flashcards').get()).toEqual({
      frente: 'F',
      lesson_id: aulaB.id,
      pendente: null,
      anki_note_id: 77,
    });
    // Sem eco: o que desceu não volta para a fila.
    expect((await b.get('/api/conta')).json().nuvem.pendentes).toBe(0);
  });

  it('progresso nunca volta; concluir vale a escolha mais recente; excluir propaga', async () => {
    const nuvem = supabaseFalso();
    const a = maquina(nuvem);
    const cursoId = createCourseFromPath(a.db, cursoNoDisco('curso-b'));
    await a.entrar('bia');
    const b = maquina(nuvem);
    await b.entrar('bia');
    const idA = (a.db.prepare("SELECT id FROM lessons WHERE rel_path='M1/01 a.mp4'").get() as any).id;
    const idB = (b.db.prepare("SELECT id FROM lessons WHERE rel_path='M1/01 a.mp4'").get() as any).id;

    // A assistiu até 100; B, offline, só até 20 e concluiu depois.
    await a.app.inject({ method: 'PATCH', url: `/api/lessons/${idA}/progress`, headers: H, payload: { position_sec: 100, furthest_sec: 100, duration_sec: 200 } });
    await a.sincronizar();
    await b.app.inject({ method: 'PATCH', url: `/api/lessons/${idB}/progress`, headers: H, payload: { position_sec: 20, furthest_sec: 20, duration_sec: 200 } });
    await b.post(`/api/lessons/${idB}/complete`, { completed: true });
    await b.sincronizar();
    await a.sincronizar();

    for (const m of [a, b]) {
      expect(m.db.prepare("SELECT p.furthest_sec, p.completed FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.rel_path='M1/01 a.mp4'").get()).toEqual({
        furthest_sec: 100,
        completed: 1,
      });
    }

    await a.app.inject({ method: 'DELETE', url: `/api/courses/${cursoId}`, headers: H });
    await a.sincronizar();
    await b.sincronizar();
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM courses').get()).toEqual({ n: 0 });
  });

  it('a pasta de um curso local é de cada máquina', async () => {
    const nuvem = supabaseFalso();
    const a = maquina(nuvem);
    const raizA = cursoNoDisco('curso-c');
    const cursoId = createCourseFromPath(a.db, raizA);
    await a.entrar('caio');
    const b = maquina(nuvem);
    await b.entrar('caio');
    b.db.prepare('UPDATE courses SET root_path=? WHERE id=?').run('/outro/lugar', cursoId);
    await b.sincronizar();
    await a.sincronizar();
    expect(a.db.prepare('SELECT root_path FROM courses').get()).toEqual({ root_path: raizA });
    expect(b.db.prepare('SELECT root_path FROM courses').get()).toEqual({ root_path: '/outro/lugar' });
  });

  it('outra conta na mesma máquina não vê a biblioteca da anterior', async () => {
    const nuvem = supabaseFalso();
    const m = maquina(nuvem);
    createCourseFromPath(m.db, cursoNoDisco('curso-d'));
    await m.entrar('davi');
    await m.post('/api/conta/sair');
    expect((await m.get('/api/courses')).statusCode).toBe(401);
    await m.entrar('eva');
    expect((await m.get('/api/courses')).json()).toEqual([]);
    expect(nuvem.linhas('cursos').every((c) => c.user_id === 'davi')).toBe(true);
  });

  it('sem rede, a mudança espera na fila e sobe quando a rede volta', async () => {
    const nuvem = supabaseFalso();
    const m = maquina(nuvem);
    await m.entrar('fabio');
    nuvem.estado.fora = true;
    m.db.prepare("INSERT INTO collections (id, name, created_at) VALUES ('c2', 'Inglês', 'x')").run();
    expect((await m.sincronizar()).json()).toMatchObject({ erro: 'sem-conexao', pendentes: 1 });
    nuvem.estado.fora = false;
    expect((await m.sincronizar()).json()).toMatchObject({ erro: null, pendentes: 0 });
    expect(nuvem.linhas('colecoes')).toMatchObject([{ nome: 'Inglês' }]);
  });

  it('PDFs: a leitura vai para a outra máquina; o arquivo é de cada uma', async () => {
    const nuvem = supabaseFalso();
    const a = maquina(nuvem);
    const pdf = path.join(tmp, 'livro.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4');
    await a.entrar('gil');
    const { ids } = (await a.post('/api/documentos', { caminhos: [pdf], tipo: 'Livros' })).json();
    await a.app.inject({ method: 'PATCH', url: `/api/documentos/${ids[0]}`, payload: { paginas: 200, pagina: 42 }, headers: H });
    await a.sincronizar();
    const b = maquina(nuvem);
    await b.entrar('gil');
    expect((await b.get('/api/documentos')).json()).toMatchObject([
      { id: ids[0], titulo: 'livro', tipo: 'Livros', pagina: 42, paginas: 200, disponivel: false },
    ]);
    // Re-apontar na B não muda o caminho da A; ler na B leva a página para a A.
    await b.post(`/api/documentos/${ids[0]}/caminho`, { caminho: pdf });
    await b.app.inject({ method: 'PATCH', url: `/api/documentos/${ids[0]}`, payload: { pagina: 90 }, headers: H });
    await b.sincronizar();
    await a.sincronizar();
    expect((await a.get(`/api/documentos/${ids[0]}`)).json()).toMatchObject({ pagina: 90, caminho: pdf, disponivel: true });
    // Remover propaga.
    await a.app.inject({ method: 'DELETE', url: `/api/documentos/${ids[0]}`, headers: H });
    await a.sincronizar();
    await b.sincronizar();
    expect((await b.get('/api/documentos')).json()).toEqual([]);
  });

  it('projeto sem as tabelas de PDFs (schema.sql antigo): os cursos continuam sincronizando', async () => {
    const nuvem = supabaseFalso();
    nuvem.tabelas.delete('documentos');
    nuvem.tabelas.delete('documentos_por_maquina');
    const m = maquina(nuvem);
    const pdf = path.join(tmp, 'outro.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4');
    m.db
      .prepare("INSERT INTO documentos (id, titulo, caminho, criado_em, atualizado_em) VALUES ('d1', 'Outro', ?, 'x', 'x')")
      .run(pdf);
    createCourseFromPath(m.db, cursoNoDisco('curso-pdf'));
    await m.entrar('hugo');
    expect((await m.sincronizar()).json()).toMatchObject({ erro: null, pendentes: 1 });
    expect(nuvem.linhas('cursos')).toHaveLength(1);
  });
});
