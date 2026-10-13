import { describe, expect, it } from 'vitest';
import { montarCurso } from './mensagens';
import type { MensagemTelegram } from './tipos';

const DIA = Date.UTC(2024, 2, 5) / 1000; // 05/03/2024

function msg(id: number, extra: Partial<MensagemTelegram>): MensagemTelegram {
  return { id, data: DIA, legenda: '', midia: null, ...extra };
}
const video = (id: number, nome: string | null, legenda = '', extra: object = {}) =>
  msg(id, { legenda, midia: { tipo: 'video', nome, tamanho: 1000 + id, mime: 'video/mp4', duracaoSec: 60, temMiniatura: true, ...extra } });
const doc = (id: number, nome: string | null, mime = 'application/pdf') =>
  msg(id, { midia: { tipo: 'documento', nome, tamanho: 50, mime, duracaoSec: null, temMiniatura: false } });

describe('montarCurso', () => {
  it('ordem de postagem vira a ordem das aulas, mesmo com nomes fora de ordem', () => {
    const r = montarCurso([video(30, 'b.mp4'), video(10, 'z.mp4'), video(20, 'a.mp4')]);
    expect(r.videos.map((v) => v.remoteId)).toEqual(['10', '20', '30']);
    expect(r.videos[0].relPath).toBe('0000000010-z.mp4');
  });

  it('título: 1ª linha da legenda; senão o nome limpo; senão a data', () => {
    const r = montarCurso([
      video(1, 'aula_01.mp4', '  Aula 1 — Introdução \nsegunda linha'),
      video(2, 'aula_02.mp4'),
      video(3, null),
    ]);
    expect(r.videos.map((v) => v.titulo)).toEqual(['Aula 1 — Introdução', 'aula 02', 'Vídeo de 05/03/2024']);
  });

  it('vídeo sem nome ganha extensão pelo mime; o relPath nunca tem barra', () => {
    const r = montarCurso([video(7, null, '', { mime: 'video/webm' }), video(8, 'mod/aula.mp4')]);
    expect(r.videos[0].relPath).toBe('0000000007-video.webm');
    expect(r.videos[1].relPath).toBe('0000000008-mod-aula.mp4');
  });

  it('vídeo mandado como arquivo (documento .mkv / mime de vídeo) também é aula', () => {
    const r = montarCurso([doc(5, 'aula.mkv', 'application/octet-stream'), doc(6, 'aula2', 'video/mp4')]);
    expect(r.videos.map((v) => v.remoteId)).toEqual(['5', '6']);
    expect(r.videos[1].relPath).toBe('0000000006-aula2.mp4');
    expect(r.materials).toEqual([]);
  });

  it('documentos viram materiais; texto, foto e o resto são ignorados', () => {
    const r = montarCurso([
      msg(1, { legenda: 'bem-vindos' }),
      msg(2, { midia: { tipo: 'outro', nome: null, tamanho: 0, mime: 'image/jpeg', duracaoSec: null, temMiniatura: true } }),
      doc(3, 'apostila.pdf'),
      doc(4, 'codigo.zip', 'application/zip'),
    ]);
    expect(r.videos).toEqual([]);
    expect(r.materials.map((m) => [m.relPath, m.kind])).toEqual([
      ['0000000003-apostila.pdf', 'pdf'],
      ['0000000004-codigo.zip', 'zip'],
    ]);
  });

  it('o mtime é a data da mensagem (estável entre re-escaneamentos)', () => {
    const r = montarCurso([video(1, 'a.mp4')]);
    expect(r.videos[0].mtime).toBe(DIA * 1000);
    expect(r.videos[0].durationSec).toBe(60);
    expect(r.videos[0].sizeBytes).toBe(1001);
  });
});
