import { describe, it, expect } from 'vitest';
import { parseExport, FORMAT, VERSION } from './format';
import path from 'node:path';

const valido = {
  format: FORMAT,
  version: VERSION,
  exportedAt: '2026-08-10T00:00:00.000Z',
  app: { version: '1.0.0', platform: 'darwin' },
  collections: [],
  courses: [],
  courseRoots: [],
  settings: { allowedRootsExtra: [] },
};

describe('parseExport', () => {
  it('aceita um arquivo do próprio Learnflix', () => {
    const r = parseExport(valido);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.courses).toEqual([]);
  });

  // Escolher o arquivo errado no seletor é o engano mais provável de todos. A
  // mensagem tem de dizer o que houve, não "erro ao importar".
  it('recusa um JSON que não é do Learnflix, dizendo o motivo', () => {
    const r = parseExport({ nome: 'outra coisa qualquer' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/não parece ser um arquivo do Learnflix/i);
  });

  it('recusa um arquivo gerado por uma versão mais nova do app', () => {
    const r = parseExport({ ...valido, version: VERSION + 1 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/versão mais nova/i);
  });

  it('recusa um arquivo com a lista de cursos corrompida', () => {
    const r = parseExport({ ...valido, courses: 'nada disso' });

    expect(r.ok).toBe(false);
  });

  // Um export antigo pode não ter campos que vieram depois. Faltar não é
  // corrupção: o import segue com o que dá, em vez de recusar o arquivo todo.
  it('tolera as seções opcionais ausentes', () => {
    const { collections, courseRoots, settings, ...semAsOpcionais } = valido;

    const r = parseExport(semAsOpcionais);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.collections).toEqual([]);
      expect(r.data.courseRoots).toEqual([]);
      expect(r.data.settings).toEqual({ allowedRootsExtra: [] });
    }
  });
});

describe('parseExport — caminhos vindos do arquivo', () => {
  const comAulas = (relPaths: string[], extras: unknown[] = []) =>
    parseExport({
      format: FORMAT,
      version: VERSION,
      courses: [
        {
          title: 'C',
          rootPath: '/cursos/c',
          lessons: relPaths.map((relPath) => ({ relPath })),
          posterLessonRelPath: '../fora.mp4',
        },
      ],
      settings: { allowedRootsExtra: extras },
    });

  // Um backup pode vir de outra pessoa: aula que aponta para fora da pasta do
  // curso faria o stream servir qualquer arquivo do disco.
  it('descarta aulas que escapam da pasta do curso', () => {
    const r = comAulas(['ok.mp4', 'Mod 1\\aula.mp4', '../../.ssh/id_rsa', '/etc/passwd', 'C:\\x.mp4', 'a/../../b.mp4']);
    if (!r.ok) throw new Error('deveria ler');
    expect(r.data.courses[0].lessons.map((l) => l.relPath)).toEqual(['ok.mp4', 'Mod 1\\aula.mp4']);
    expect(r.data.courses[0].posterLessonRelPath).toBeNull();
  });

  it('só aceita raízes extras absolutas', () => {
    const r = comAulas([], ['relativa/pasta', 42, '/Volumes/Cursos']);
    if (!r.ok) throw new Error('deveria ler');
    expect(r.data.settings.allowedRootsExtra).toEqual([path.resolve('/Volumes/Cursos')]);
  });
});

describe('parseExport e cursos do Drive', () => {
  it('backup antigo sem source continua válido', () => {
    const r = parseExport({
      ...valido,
      courses: [{ title: 'C', rootPath: '/x', structure: 'flat', lessons: [] }],
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.courses[0].source).toBeUndefined();
      expect(r.data.courses[0].driveFolderId).toBeUndefined();
    }
  });

  it('descarta campos do Drive com tipo errado em vez de recusar o arquivo', () => {
    const r = parseExport({
      ...valido,
      courses: [{ title: 'C', rootPath: '/x', structure: 'flat', lessons: [], source: 'ftp', driveFolderId: 5 }],
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.courses[0].source).toBeUndefined();
      expect(r.data.courses[0].driveFolderId).toBeUndefined();
    }
  });
});
