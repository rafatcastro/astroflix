import { describe, expect, it } from 'vitest';
import type { ArquivoDrive, ClienteDrive } from './api';
import { FalhaDrive } from './tipos';
import { walkDrive } from './walk';

const PASTA = 'application/vnd.google-apps.folder';
const ATALHO = 'application/vnd.google-apps.shortcut';

type No = ArquivoDrive;

// Cliente falso montado a partir de uma lista de nós e de quem é filho de quem.
function falso(nos: No[], filhos: Record<string, string[]>, negados: string[] = []): ClienteDrive {
  const porId = new Map(nos.map((n) => [n.id, n]));
  return {
    async getArquivo(id) {
      if (negados.includes(id)) throw new FalhaDrive('sem-acesso', 404);
      const n = porId.get(id);
      if (!n) throw new FalhaDrive('sem-acesso', 404);
      return n;
    },
    async listarFilhos(id) {
      return (filhos[id] ?? []).map((f) => porId.get(f)!);
    },
    async baixar() {
      throw new Error('não usado');
    },
  };
}

const pasta = (id: string, name: string): No => ({ id, name, mimeType: PASTA });
const arq = (id: string, name: string, extra: Partial<No> = {}): No => ({
  id,
  name,
  mimeType: 'application/octet-stream',
  ...extra,
});

describe('walkDrive', () => {
  it('pasta com subpastas → relPath com nomes de pasta', async () => {
    const c = falso(
      [pasta('r', 'Curso'), pasta('m1', 'Módulo 1'), arq('v1', '01 Intro.mp4')],
      { r: ['m1'], m1: ['v1'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.titulo).toBe('Curso');
    expect(res.videos.map((v) => v.relPath)).toEqual(['Módulo 1/01 Intro.mp4']);
    expect(res.videos[0].remoteId).toBe('v1');
  });

  it('vídeo vs material pela extensão', async () => {
    const c = falso([pasta('r', 'C'), arq('a', 'a.mp4'), arq('b', 'b.pdf'), arq('c', 'c.xyz')], {
      r: ['a', 'b', 'c'],
    });
    const res = await walkDrive(c, 'r');
    expect(res.videos.map((v) => v.relPath)).toEqual(['a.mp4']);
    expect(res.materials.map((m) => [m.relPath, m.kind])).toEqual([
      ['b.pdf', 'pdf'],
      ['c.xyz', 'other'],
    ]);
  });

  it('ignora Google Docs e nomes com ponto', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        arq('d', 'Doc', { mimeType: 'application/vnd.google-apps.document' }),
        arq('h', '.DS_Store'),
        arq('v', 'v.mp4'),
      ],
      { r: ['d', 'h', 'v'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.videos).toHaveLength(1);
    expect(res.materials).toHaveLength(0);
  });

  it('duração e tamanho vêm do Drive', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        arq('v', 'v.mp4', {
          size: '1234',
          modifiedTime: '2026-01-01T00:00:00.000Z',
          thumbnailLink: 'http://t',
          videoMediaMetadata: { durationMillis: '90500' },
        }),
        arq('w', 'w.mp4'),
      ],
      { r: ['v', 'w'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.videos[0]).toMatchObject({
      sizeBytes: 1234,
      mtime: Date.parse('2026-01-01T00:00:00.000Z'),
      durationSec: 90.5,
      thumbnailLink: 'http://t',
    });
    expect(res.videos[1]).toMatchObject({
      sizeBytes: 0,
      mtime: 0,
      durationSec: null,
      thumbnailLink: null,
    });
  });

  it('atalho para pasta entra como subpasta', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        pasta('o', 'Original'),
        arq('s', 'Atalho', {
          mimeType: ATALHO,
          shortcutDetails: { targetId: 'o', targetMimeType: PASTA },
        }),
        arq('v', 'v.mp4'),
      ],
      { r: ['s'], o: ['v'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.videos.map((v) => v.relPath)).toEqual(['Atalho/v.mp4']);
  });

  it('atalho para arquivo usa o nome do atalho e os dados do alvo', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        arq('alvo', 'original.mp4', { size: '10' }),
        arq('s', 'apelido.mp4', {
          mimeType: ATALHO,
          shortcutDetails: { targetId: 'alvo', targetMimeType: 'video/mp4' },
        }),
      ],
      { r: ['s'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.videos[0]).toMatchObject({ relPath: 'apelido.mp4', remoteId: 'alvo', sizeBytes: 10 });
  });

  it('atalho sem acesso é pulado; outros erros propagam', async () => {
    const atalho = (id: string, alvo: string): No =>
      arq(id, id + '.mp4', { mimeType: ATALHO, shortcutDetails: { targetId: alvo, targetMimeType: 'video/mp4' } });
    const nos = [pasta('r', 'C'), atalho('s', 'x'), arq('v', 'v.mp4')];
    const res = await walkDrive(falso(nos, { r: ['s', 'v'] }, ['x']), 'r');
    expect(res.videos.map((v) => v.relPath)).toEqual(['v.mp4']);

    const c = falso(nos, { r: ['s'] });
    c.getArquivo = async (id) => {
      if (id === 'x') throw new FalhaDrive('cota-esgotada', 403);
      return nos.find((n) => n.id === id)!;
    };
    await expect(walkDrive(c, 'r')).rejects.toMatchObject({ tipo: 'cota-esgotada' });
  });

  it('link de arquivo → nao-e-pasta', async () => {
    const c = falso([arq('a', 'a.mp4')], {});
    await expect(walkDrive(c, 'a')).rejects.toMatchObject({ tipo: 'nao-e-pasta' });
  });

  it('nomes repetidos na mesma pasta ganham sufixo', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        arq('novo', 'aula.mp4', { createdTime: '2026-01-02T00:00:00Z' }),
        arq('velho', 'aula.mp4', { createdTime: '2026-01-01T00:00:00Z' }),
      ],
      { r: ['novo', 'velho'] },
    );
    const res = await walkDrive(c, 'r');
    const por = Object.fromEntries(res.videos.map((v) => [v.remoteId, v.relPath]));
    expect(por.velho).toBe('aula.mp4');
    expect(por.novo).toBe('aula (2).mp4');
  });

  it('pastas repetidas ganham sufixo no segmento da pasta', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        { ...pasta('p1', 'M'), createdTime: '2026-01-01T00:00:00Z' },
        { ...pasta('p2', 'M'), createdTime: '2026-01-02T00:00:00Z' },
        arq('a', 'x.mp4'),
        arq('b', 'y.mp4'),
      ],
      { r: ['p2', 'p1'], p1: ['a'], p2: ['b'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.videos.map((v) => v.relPath).sort()).toEqual(['M (2)/y.mp4', 'M/x.mp4']);
  });

  it('barra no nome vira hífen', async () => {
    const c = falso([pasta('r', 'C'), pasta('p', 'A/B'), arq('v', 'x.mp4')], { r: ['p'], p: ['v'] });
    const res = await walkDrive(c, 'r');
    expect(res.videos[0].relPath).toBe('A-B/x.mp4');
  });

  it('atalho para pasta ancestral não entra em loop', async () => {
    const c = falso(
      [
        pasta('r', 'C'),
        arq('s', 'Volta', { mimeType: ATALHO, shortcutDetails: { targetId: 'r', targetMimeType: PASTA } }),
        arq('v', 'v.mp4'),
      ],
      { r: ['s', 'v'] },
    );
    const res = await walkDrive(c, 'r');
    expect(res.videos.map((v) => v.relPath)).toEqual(['v.mp4']);
  });

  it('pasta alcançável por atalho: relPath não depende da ordem da listagem', async () => {
    const nos = [
      pasta('r', 'C'),
      { ...pasta('o', 'Original'), createdTime: '2026-01-01T00:00:00Z' },
      arq('s', 'Atalho', {
        mimeType: ATALHO,
        createdTime: '2026-01-02T00:00:00Z',
        shortcutDetails: { targetId: 'o', targetMimeType: PASTA },
      }),
      arq('v', 'v.mp4'),
    ];
    const a = await walkDrive(falso(nos, { r: ['o', 's'], o: ['v'] }), 'r');
    const b = await walkDrive(falso(nos, { r: ['s', 'o'], o: ['v'] }), 'r');
    expect(b.videos.map((v) => v.relPath)).toEqual(a.videos.map((v) => v.relPath));
    expect(a.videos.map((v) => v.relPath)).toEqual(['Original/v.mp4']);
  });

  describe('listagem em paralelo', () => {
    // Árvore com 8 subpastas, mais uma pasta alcançável por real + atalho.
    function arvore() {
      const nos: No[] = [pasta('r', 'C'), { ...pasta('shared', 'Shared'), createdTime: '2026-03-01T00:00:00Z' }];
      const filhos: Record<string, string[]> = { r: [], shared: ['sv'] };
      nos.push(arq('sv', 'sv.mp4'));
      for (let i = 0; i < 8; i++) {
        nos.push({ ...pasta(`p${i}`, `M${i}`), createdTime: `2026-01-0${i + 1}T00:00:00Z` });
        nos.push(arq(`v${i}`, `v${i}.mp4`));
        filhos[`p${i}`] = [`v${i}`];
        filhos.r.push(`p${i}`);
      }
      // p0 contém um atalho para 'shared' e a raiz também: quem vem primeiro (p0) ganha.
      nos.push(arq('sc', 'Atalho', { mimeType: ATALHO, shortcutDetails: { targetId: 'shared', targetMimeType: PASTA } }));
      filhos.p0.push('sc');
      filhos.p5.push('sc');
      filhos.r.push('shared');
      return { nos, filhos };
    }

    function comLatencia(c: ClienteDrive, ms: (id: string) => number, rastro?: { ativos: number; pico: number }): ClienteDrive {
      return {
        ...c,
        async listarFilhos(id) {
          if (rastro) rastro.pico = Math.max(rastro.pico, ++rastro.ativos);
          await new Promise((r) => setTimeout(r, ms(id)));
          try {
            return await c.listarFilhos(id);
          } finally {
            if (rastro) rastro.ativos--;
          }
        },
      };
    }

    it('latências invertidas produzem os mesmos relPaths do caminho sequencial', async () => {
      const { nos, filhos } = arvore();
      const base = await walkDrive(falso(nos, filhos), 'r');
      const lento = await walkDrive(
        comLatencia(falso(nos, filhos), (id) => (id === 'p0' ? 40 : id === 'shared' ? 1 : 20 - (Number(id.slice(1)) || 0))),
        'r',
      );
      expect(lento.videos.map((v) => v.relPath)).toEqual(base.videos.map((v) => v.relPath));
      // 'shared' é alcançado primeiro por p0 (ordem createdTime/id), não pela raiz.
      expect(base.videos.map((v) => v.relPath)).toContain('M0/Atalho/sv.mp4');
    });

    it('lista até 6 pastas ao mesmo tempo, não mais', async () => {
      const { nos, filhos } = arvore();
      const rastro = { ativos: 0, pico: 0 };
      await walkDrive(comLatencia(falso(nos, filhos), () => 10, rastro), 'r');
      expect(rastro.pico).toBeGreaterThan(1);
      expect(rastro.pico).toBeLessThanOrEqual(6);
    });

    it('erro ao listar uma subpasta propaga, sem rejeição solta das outras', async () => {
      const { nos, filhos } = arvore();
      const c = falso(nos, filhos);
      const orig = c.listarFilhos;
      c.listarFilhos = async (id) => {
        if (id === 'p3') throw new FalhaDrive('cota-esgotada', 403);
        return orig(id);
      };
      await expect(walkDrive(c, 'r')).rejects.toMatchObject({ tipo: 'cota-esgotada' });
    });
  });
});
