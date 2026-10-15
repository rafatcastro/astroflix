import { describe, it, expect } from 'vitest';
import { openDb } from '../db';
import { loadConfig } from '../config';
import { buildApp } from '../app';
import { criarClienteAnki } from '../anki/cliente';
import { ankiFalso } from '../anki/anki-falso';

function montar() {
  const db = openDb(':memory:');
  db.prepare(
    "INSERT INTO courses (id, title, root_path, structure, created_at, updated_at) VALUES ('c1', 'Algoritmos', '/x', 'modules', 'x', 'x')",
  ).run();
  db.prepare(
    `INSERT INTO lessons (id, course_id, rel_path, title, order_index, module_order, size_bytes, mtime, container, playable)
     VALUES ('l1', 'c1', 'm/01.mp4', 'Big O', 0, 0, 1, 1, 'mp4', 1)`,
  ).run();
  const falso = ankiFalso();
  const app = buildApp(loadConfig({}), db, { anki: criarClienteAnki(falso.fetch) });
  const criar = (payload: object) => app.inject({ method: 'POST', url: '/api/flashcards', payload });
  const listar = async (qs = '') => (await app.inject({ method: 'GET', url: `/api/flashcards${qs}` })).json();
  return { db, app, anki: falso.estado, criar, listar };
}

const nota = (anki: ReturnType<typeof ankiFalso>['estado']) => [...anki.notas.values()][0];

describe('flashcards e Anki', () => {
  it('card de aula vai para o baralho do curso, com a origem e o minuto', async () => {
    const { anki, criar } = montar();
    const r = await criar({ frente: 'O que é O(n)?', verso: 'Linear', lessonId: 'l1', minutoSec: 760 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ anki: 'conectado', card: { courseId: 'c1', lessonId: 'l1', minutoSec: 760, noAnki: true } });
    expect(anki.modelos.has('Learnflix')).toBe(true);
    expect(nota(anki)).toEqual({
      baralho: 'Astroflix::Sem categoria::Cursos::Algoritmos',
      campos: { Frente: 'O que é O(n)?', Verso: 'Linear', Origem: 'Algoritmos › Big O · 12:40' },
      tags: ['learnflix'],
    });
    expect(anki.sincronizou).toBe(1);
  });

  it('card geral sem categoria vai para a raiz Astroflix', async () => {
    const { anki, criar, listar } = montar();
    await criar({ frente: 'F', verso: 'V' });
    expect(nota(anki).baralho).toBe('Astroflix');
    expect(nota(anki).campos.Origem).toBe('Geral');
    expect((await listar('?geral=1')).cards).toHaveLength(1);
    expect((await listar('?lessonId=l1')).cards).toHaveLength(0);
  });

  it('com o Anki fechado o card fica pendente e vai quando ele abre', async () => {
    const { anki, criar, listar } = montar();
    anki.aberto = false;
    const r = await criar({ frente: 'F', verso: 'V', lessonId: 'l1' });
    expect(r.json()).toMatchObject({ anki: 'fechado', card: { noAnki: false } });
    expect(await listar('?lessonId=l1')).toMatchObject({ anki: 'fechado', pendentes: 1 });

    anki.aberto = true;
    const lista = await listar('?lessonId=l1');
    expect(lista).toMatchObject({ anki: 'conectado', pendentes: 0, cards: [{ noAnki: true }] });
    expect(anki.notas.size).toBe(1);
  });

  it('edição e exclusão feitas no Anki aparecem no app', async () => {
    const { anki, criar, listar } = montar();
    await criar({ frente: 'A', verso: '1', lessonId: 'l1' });
    await criar({ frente: 'B', verso: '2', lessonId: 'l1' });
    const [idA, idB] = [...anki.notas.keys()];
    anki.notas.get(idA)!.campos.Verso = 'um<div>linha 2</div>';
    anki.notas.delete(idB);

    const { cards } = await listar('?lessonId=l1');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ frente: 'A', verso: 'um\nlinha 2' });
  });

  // Outro perfil aberto no Anki: nenhuma nota é achada, e nada pode ser apagado.
  it('se nenhuma nota é achada no Anki, a cópia local fica', async () => {
    const { anki, criar, listar } = montar();
    await criar({ frente: 'A', verso: '1', lessonId: 'l1' });
    await criar({ frente: 'B', verso: '2', lessonId: 'l1' });
    anki.notas.clear();
    expect((await listar('?lessonId=l1')).cards).toHaveLength(2);
  });

  // O único card de uma lista apagado no Anki: os outros cards provam que é o mesmo perfil.
  it('card sozinho na lista e apagado no Anki sai do app', async () => {
    const { anki, criar, listar } = montar();
    await criar({ frente: 'Geral', verso: '1' });
    await criar({ frente: 'Da aula', verso: '2', lessonId: 'l1' });
    anki.notas.delete([...anki.notas.keys()][0]);
    expect((await listar('?geral=1')).cards).toHaveLength(0);
    expect((await listar('?lessonId=l1')).cards).toHaveLength(1);
  });

  it('editar e apagar no app chegam ao Anki', async () => {
    const { app, anki, criar, listar } = montar();
    const { card } = (await criar({ frente: 'A', verso: '1', lessonId: 'l1' })).json();
    const r = await app.inject({ method: 'PATCH', url: `/api/flashcards/${card.id}`, payload: { verso: 'novo\nverso' } });
    expect(r.json()).toMatchObject({ anki: 'conectado', card: { verso: 'novo\nverso', noAnki: true } });
    expect(nota(anki).campos.Verso).toBe('novo<br>verso');

    await app.inject({ method: 'DELETE', url: `/api/flashcards/${card.id}` });
    expect(anki.notas.size).toBe(0);
    expect((await listar()).cards).toHaveLength(0);
  });

  it('apagar com o Anki fechado esconde o card e apaga a nota depois', async () => {
    const { app, anki, criar, listar } = montar();
    const { card } = (await criar({ frente: 'A', verso: '1' })).json();
    anki.aberto = false;
    await app.inject({ method: 'DELETE', url: `/api/flashcards/${card.id}` });
    expect((await listar()).cards).toHaveLength(0);
    expect(anki.notas.size).toBe(1);
    anki.aberto = true;
    await listar();
    expect(anki.notas.size).toBe(0);
  });

  it('card nunca enviado, editado e apagado não chega ao Anki', async () => {
    const { app, anki, criar } = montar();
    anki.aberto = false;
    const { card } = (await criar({ frente: 'A', verso: '1' })).json();
    await app.inject({ method: 'PATCH', url: `/api/flashcards/${card.id}`, payload: { frente: 'B' } });
    anki.aberto = true;
    await app.inject({ method: 'GET', url: '/api/flashcards' });
    expect(nota(anki).campos.Frente).toBe('B');
  });

  it('nota apagada no Anki e editada no app volta como nota nova', async () => {
    const { app, anki, criar } = montar();
    const { card } = (await criar({ frente: 'A', verso: '1' })).json();
    anki.notas.clear();
    await app.inject({ method: 'PATCH', url: `/api/flashcards/${card.id}`, payload: { frente: 'A2' } });
    const r = await app.inject({ method: 'GET', url: '/api/flashcards' });
    expect(r.json().cards[0]).toMatchObject({ frente: 'A2', noAnki: true });
    expect(nota(anki).campos.Frente).toBe('A2');
  });

  it('Anki recusando a nota deixa o card pendente e avisa erro', async () => {
    const { anki, criar } = montar();
    anki.recusar = 'addNote';
    const r = await criar({ frente: 'A', verso: '1' });
    expect(r.json()).toMatchObject({ anki: 'erro', card: { noAnki: false } });
  });

  it('valida o corpo', async () => {
    const { criar } = montar();
    expect((await criar({ frente: '  ', verso: 'x' })).statusCode).toBe(400);
    expect((await criar({ frente: 'a', verso: 'x', lessonId: 'nao-existe' })).statusCode).toBe(404);
  });

  it('aula apagada no re-scan deixa o card no curso', async () => {
    const { db, criar, listar } = montar();
    await criar({ frente: 'A', verso: '1', lessonId: 'l1' });
    db.prepare("DELETE FROM lessons WHERE id='l1'").run();
    expect((await listar('?courseId=c1')).cards[0]).toMatchObject({ courseId: 'c1', lessonId: null });
  });

  it('status diz se o Anki responde', async () => {
    const { app, anki } = montar();
    expect((await app.inject({ method: 'GET', url: '/api/anki/status' })).json()).toEqual({ estado: 'conectado', pendentes: 0 });
    anki.aberto = false;
    expect((await app.inject({ method: 'GET', url: '/api/anki/status' })).json()).toEqual({ estado: 'fechado', pendentes: 0 });
  });

  it('categoria: gerais em Astroflix::<categoria>, cursos e PDFs embaixo, e a lista da categoria pega tudo', async () => {
    const { db, anki, criar, listar } = montar();
    db.prepare("INSERT INTO collections (id, name, created_at) VALUES ('k1', 'Pós', 'x')").run();
    db.prepare("UPDATE courses SET collection_id='k1' WHERE id='c1'").run();
    db.prepare(
      "INSERT INTO documentos (id, titulo, caminho, collection_id, criado_em, atualizado_em) VALUES ('d1', 'Cálculo I', '/x.pdf', 'k1', 'x', 'x')",
    ).run();
    await criar({ frente: 'Geral', verso: 'V', categoriaId: 'k1' });
    await criar({ frente: 'Aula', verso: 'V', lessonId: 'l1' });
    const r = await criar({ frente: 'Página', verso: 'V', documentoId: 'd1', pagina: 12 });
    expect(r.json().card).toMatchObject({ documentoId: 'd1', pagina: 12, baralho: 'Astroflix::Pós::PDFs::Cálculo I' });
    const porFrente = Object.fromEntries([...anki.notas.values()].map((n) => [n.campos.Frente, n]));
    expect(porFrente.Geral.baralho).toBe('Astroflix::Pós');
    expect(porFrente.Aula.baralho).toBe('Astroflix::Pós::Cursos::Algoritmos');
    expect(porFrente['Página']).toMatchObject({ baralho: 'Astroflix::Pós::PDFs::Cálculo I', campos: { Origem: 'Cálculo I · p. 12' } });
    expect((await listar('?categoria=k1')).cards).toHaveLength(3);
    expect((await listar('?categoria=k1&geral=1')).cards).toHaveLength(1);
    expect((await listar('?documentoId=d1')).cards).toHaveLength(1);
    expect((await listar('?categoria=sem')).cards).toHaveLength(0);
  });

  it('cards da estrutura antiga e de curso que mudou de categoria são movidos, e o baralho vazio sai', async () => {
    const { db, anki, criar, listar } = montar();
    await criar({ frente: 'Velho', verso: 'V', lessonId: 'l1' });
    // Como estava até a v2.1.25: no baralho antigo, sem baralho anotado.
    const [id] = [...anki.notas.keys()];
    anki.notas.get(id)!.baralho = 'Learnflix::Cursos::Algoritmos';
    anki.baralhos.add('Learnflix::Cursos').add('Learnflix::Cursos::Algoritmos');
    db.prepare('UPDATE flashcards SET baralho=NULL').run();
    await listar();
    expect(anki.notas.get(id)!.baralho).toBe('Astroflix::Sem categoria::Cursos::Algoritmos');
    expect([...anki.baralhos].filter((b) => b.startsWith('Learnflix::Cursos'))).toEqual([]);

    db.prepare("INSERT INTO collections (id, name, created_at) VALUES ('k2', 'Concurso', 'x')").run();
    db.prepare("UPDATE courses SET collection_id='k2' WHERE id='c1'").run();
    await listar();
    expect(anki.notas.get(id)!.baralho).toBe('Astroflix::Concurso::Cursos::Algoritmos');
    // E do nome antigo do app (Learnflix::…): vem para Astroflix, e a raiz velha vazia sai.
    anki.notas.get(id)!.baralho = 'Learnflix::Concurso::Cursos::Algoritmos';
    anki.baralhos.add('Learnflix').add('Learnflix::Concurso::Cursos::Algoritmos');
    db.prepare("UPDATE flashcards SET baralho='Learnflix::Concurso::Cursos::Algoritmos'").run();
    await listar();
    expect(anki.notas.get(id)!.baralho).toBe('Astroflix::Concurso::Cursos::Algoritmos');
    expect([...anki.baralhos].some((b) => b === 'Learnflix' || b.startsWith('Learnflix::'))).toBe(false);
    expect([...anki.baralhos].some((b) => b.startsWith('Astroflix::Sem categoria'))).toBe(false);
  });
});
