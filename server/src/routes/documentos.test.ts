import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../db';
import { loadConfig } from '../config';
import { buildApp } from '../app';

let raiz: string;
let dados: string;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));
  dados = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-dados-'));
  fs.mkdirSync(path.join(raiz, 'Livros', 'Sub'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'Livros', '.oculta'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'Livros', 'Livro 10.pdf'), '%PDF-1.4 dez');
  fs.writeFileSync(path.join(raiz, 'Livros', 'Livro 2.PDF'), '%PDF-1.4 dois');
  fs.writeFileSync(path.join(raiz, 'Livros', 'Sub', 'questoes_2024.pdf'), '%PDF-1.4 0123456789');
  fs.writeFileSync(path.join(raiz, 'Livros', '.oculta', 'x.pdf'), '%PDF');
  fs.writeFileSync(path.join(raiz, 'Livros', 'notas.txt'), 'não é pdf');
});
afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  fs.rmSync(dados, { recursive: true, force: true });
});

function montar() {
  const db = openDb(':memory:');
  const app = buildApp(loadConfig({ ALLOWED_ROOTS: raiz, DATA_DIR: dados }), db, { supabase: null });
  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/documentos', payload });
  const listar = async () => (await app.inject({ method: 'GET', url: '/api/documentos' })).json();
  return { db, app, post, listar };
}

describe('documentos (PDFs)', () => {
  it('adiciona uma pasta: cada PDF dentro dela, subpastas inclusive, sem ocultos nem outros arquivos', async () => {
    const { post, listar } = montar();
    const r = await post({ pasta: path.join(raiz, 'Livros'), tipo: '  Livros ' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ criados: 3, jaExistiam: 0 });
    const lista = await listar();
    expect(lista.map((d: any) => d.titulo)).toEqual(['Livro 2', 'Livro 10', 'questoes 2024']);
    expect(lista[0]).toMatchObject({ tipo: 'Livros', categoriaId: null, pagina: 1, lido: false, disponivel: true, temCapa: false });
    // De novo: não duplica.
    expect((await post({ pasta: path.join(raiz, 'Livros') })).json()).toMatchObject({ criados: 0, jaExistiam: 3 });
  });

  it('arquivos escolhidos: recusa o que não é PDF e o que está fora das pastas permitidas', async () => {
    const { post } = montar();
    const r = await post({
      caminhos: [path.join(raiz, 'Livros', 'Livro 10.pdf'), path.join(raiz, 'Livros', 'notas.txt'), '/etc/passwd.pdf'],
    });
    expect(r.json()).toMatchObject({ criados: 1, recusados: 2 });
    expect((await post({ pasta: '/etc' })).statusCode).toBe(403);
  });

  it('serve o arquivo com Range, para o pdf.js abrir um livro grande sem ler tudo', async () => {
    const { app, post } = montar();
    const [id] = (await post({ caminhos: [path.join(raiz, 'Livros', 'Sub', 'questoes_2024.pdf')] })).json().ids;
    const r = await app.inject({ method: 'GET', url: `/api/documentos/${id}/arquivo`, headers: { range: 'bytes=0-4' } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body).toBe('%PDF-');
  });

  it('caminho do banco fora das pastas permitidas não é servido', async () => {
    const { app, db, post } = montar();
    const [id] = (await post({ caminhos: [path.join(raiz, 'Livros', 'Livro 10.pdf')] })).json().ids;
    db.prepare('UPDATE documentos SET caminho=? WHERE id=?').run('/etc/segredo.pdf', id);
    expect((await app.inject({ method: 'GET', url: `/api/documentos/${id}/arquivo` })).statusCode).toBe(403);
  });

  it('guarda a página onde parou; chegar à última marca como lido; desmarcar volta', async () => {
    const { app, post } = montar();
    const [id] = (await post({ caminhos: [path.join(raiz, 'Livros', 'Livro 10.pdf')] })).json().ids;
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/documentos/${id}`, payload });
    let d = (await patch({ paginas: 300, pagina: 120 })).json();
    expect(d).toMatchObject({ pagina: 120, paginas: 300, lido: false });
    expect(d.leituraEm).toBeTruthy();
    d = (await patch({ pagina: 300 })).json();
    expect(d).toMatchObject({ pagina: 300, lido: true });
    d = (await patch({ lido: false })).json();
    expect(d).toMatchObject({ lido: false, lidoEm: null });
    d = (await patch({ titulo: 'Cálculo I', tipo: 'Apostilas' })).json();
    expect(d).toMatchObject({ titulo: 'Cálculo I', tipo: 'Apostilas', pagina: 300 });
  });

  it('remover tira só do app (o arquivo fica) e leva a capa', async () => {
    const { app, post, listar } = montar();
    const arquivo = path.join(raiz, 'Livros', 'Livro 2.PDF');
    const [id] = (await post({ caminhos: [arquivo] })).json().ids;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('resto')]);
    const put = await app.inject({ method: 'PUT', url: `/api/documentos/${id}/capa`, payload: png, headers: { 'content-type': 'image/png' } });
    expect(put.statusCode).toBe(204);
    expect((await listar())[0].temCapa).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/documentos/${id}/capa` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/documentos/${id}` })).statusCode).toBe(204);
    expect(await listar()).toEqual([]);
    expect(fs.existsSync(arquivo)).toBe(true);
    expect(fs.existsSync(path.join(dados, 'thumbs', `documento-${id}.png`))).toBe(false);
  });

  it('re-apontar troca o arquivo e mantém a leitura', async () => {
    const { app, db, post } = montar();
    const [id] = (await post({ caminhos: [path.join(raiz, 'Livros', 'Livro 10.pdf')] })).json().ids;
    await app.inject({ method: 'PATCH', url: `/api/documentos/${id}`, payload: { paginas: 50, pagina: 7 } });
    db.prepare('UPDATE documentos SET caminho=? WHERE id=?').run(path.join(raiz, 'sumiu.pdf'), id);
    expect((await app.inject({ method: 'GET', url: `/api/documentos/${id}` })).json().disponivel).toBe(false);
    const r = await app.inject({
      method: 'POST',
      url: `/api/documentos/${id}/caminho`,
      payload: { caminho: path.join(raiz, 'Livros', 'Sub', 'questoes_2024.pdf') },
    });
    expect(r.json()).toMatchObject({ disponivel: true, pagina: 7 });
  });

  it('cada mudança entra na fila da nuvem', async () => {
    const { db, post } = montar();
    await post({ caminhos: [path.join(raiz, 'Livros', 'Livro 10.pdf')] });
    expect(db.prepare("SELECT COUNT(*) AS n FROM nuvem_fila WHERE tabela='documento'").get()).toEqual({ n: 1 });
  });

  it('categoria: adicionar dentro dela, filtrar por ela e mudar de categoria', async () => {
    const { app, db, post } = montar();
    db.prepare("INSERT INTO collections (id, name, created_at) VALUES ('k1', 'Pós', 'x')").run();
    const [id] = (await post({ caminhos: [path.join(raiz, 'Livros', 'Livro 10.pdf')], categoriaId: 'k1' })).json().ids;
    await post({ caminhos: [path.join(raiz, 'Livros', 'Livro 2.PDF')] });
    const lista = async (q: string) => (await app.inject({ method: 'GET', url: `/api/documentos?categoria=${q}` })).json();
    expect((await lista('k1')).map((d: any) => d.id)).toEqual([id]);
    expect(await lista('sem')).toHaveLength(1);
    await app.inject({ method: 'PATCH', url: `/api/documentos/${id}`, payload: { categoriaId: null } });
    expect(await lista('sem')).toHaveLength(2);
    const cols = (await app.inject({ method: 'GET', url: '/api/collections' })).json();
    expect(cols[0]).toMatchObject({ name: 'Pós', pdfCount: 0, acessadoEm: null });
  });
});
