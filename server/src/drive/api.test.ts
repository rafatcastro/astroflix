import { describe, it, expect } from 'vitest';
import { criarClienteDrive, CAMPOS_ARQUIVO } from './api';
import { FalhaDrive } from './tipos';

type Item = Response | Error;

function montar(fila: Item[], opts: { token?: (o?: { renovar?: boolean }) => Promise<string | null>; resourceKeys?: string | null } = {}) {
  const chamadas: { url: URL; headers: Headers }[] = [];
  const esperas: number[] = [];
  const tokenChamadas: ({ renovar?: boolean } | undefined)[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    chamadas.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    const item = fila.shift();
    if (!item) throw new Error('fila vazia');
    if (item instanceof Error) throw item;
    return item;
  }) as typeof fetch;
  const cliente = criarClienteDrive({
    fetch: f,
    apiKey: 'KEY',
    token: async (o) => {
      tokenChamadas.push(o);
      return opts.token ? opts.token(o) : null;
    },
    esperar: async (ms) => {
      esperas.push(ms);
    },
    resourceKeys: opts.resourceKeys,
  });
  return { cliente, chamadas, esperas, tokenChamadas };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const erro = (status: number, reason: string) => json({ error: { errors: [{ reason }] } }, status);
const arq = (id: string) => ({ id, name: id, mimeType: 'video/mp4' });

describe('cliente da Drive API', () => {
  it('usa key= sem token e Bearer com token', async () => {
    const a = montar([json(arq('1'))]);
    await a.cliente.getArquivo('1');
    expect(a.chamadas[0].url.searchParams.get('key')).toBe('KEY');
    expect(a.chamadas[0].url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(a.chamadas[0].url.searchParams.get('fields')).toBe(CAMPOS_ARQUIVO);
    expect(a.chamadas[0].headers.get('authorization')).toBeNull();

    const b = montar([json(arq('1'))], { token: async () => 'TOK' });
    await b.cliente.getArquivo('1');
    expect(b.chamadas[0].headers.get('authorization')).toBe('Bearer TOK');
    expect(b.chamadas[0].url.searchParams.has('key')).toBe(false);
  });

  it('listarFilhos segue nextPageToken', async () => {
    const { cliente, chamadas } = montar([
      json({ nextPageToken: 'P2', files: [arq('a'), arq('b')] }),
      json({ files: [arq('c')] }),
    ]);
    const r = await cliente.listarFilhos('PASTA');
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    const u = chamadas[0].url;
    expect(u.searchParams.get('q')).toBe("'PASTA' in parents and trashed=false");
    expect(u.searchParams.get('pageSize')).toBe('1000');
    expect(u.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(u.searchParams.get('fields')).toBe(`nextPageToken,files(${CAMPOS_ARQUIVO})`);
    expect(chamadas[1].url.searchParams.get('pageToken')).toBe('P2');
  });

  it('429 e 503 repetem com espera 2^n+1 s e depois funcionam', async () => {
    const { cliente, esperas } = montar([erro(429, 'rateLimitExceeded'), erro(503, 'backendError'), json(arq('1'))]);
    expect((await cliente.getArquivo('1')).id).toBe('1');
    expect(esperas).toEqual([2000, 3000]);
  });

  it('403 rateLimitExceeded também repete', async () => {
    const { cliente, esperas } = montar([erro(403, 'userRateLimitExceeded'), json(arq('1'))]);
    await cliente.getArquivo('1');
    expect(esperas).toEqual([2000]);
  });

  it('desiste depois de 6 tentativas → FalhaDrive google', async () => {
    const fila = Array.from({ length: 6 }, () => erro(503, 'backendError'));
    const { cliente, chamadas, esperas } = montar(fila);
    await expect(cliente.getArquivo('1')).rejects.toMatchObject({ tipo: 'google', status: 503 });
    expect(chamadas).toHaveLength(6);
    expect(esperas).toEqual([2000, 3000, 5000, 9000, 17000]);
  });

  it('404 → sem-acesso', async () => {
    const { cliente } = montar([erro(404, 'notFound')]);
    await expect(cliente.getArquivo('1')).rejects.toMatchObject({ tipo: 'sem-acesso' });
  });

  it('403 insufficientFilePermissions → sem-acesso', async () => {
    const { cliente } = montar([erro(403, 'insufficientFilePermissions')]);
    await expect(cliente.getArquivo('1')).rejects.toBeInstanceOf(FalhaDrive);
    const b = montar([erro(403, 'insufficientFilePermissions')]);
    await expect(b.cliente.getArquivo('1')).rejects.toMatchObject({ tipo: 'sem-acesso' });
  });

  it('403 downloadQuotaExceeded → cota-esgotada, sem repetir', async () => {
    const { cliente, chamadas } = montar([erro(403, 'downloadQuotaExceeded')]);
    await expect(cliente.baixar('1', undefined)).rejects.toMatchObject({ tipo: 'cota-esgotada' });
    expect(chamadas).toHaveLength(1);
  });

  it('TypeError do fetch, repetido até o fim → sem-conexao', async () => {
    const fila = Array.from({ length: 6 }, () => new TypeError('fetch failed'));
    const { cliente, chamadas } = montar(fila);
    await expect(cliente.getArquivo('1')).rejects.toMatchObject({ tipo: 'sem-conexao' });
    expect(chamadas).toHaveLength(6);
  });

  it('401 renova o token uma vez e repete', async () => {
    const { cliente, tokenChamadas, chamadas } = montar(
      [new Response('', { status: 401 }), new Response('x', { status: 206 })],
      { token: async (o) => (o?.renovar ? 'NOVO' : 'VELHO') },
    );
    const r = await cliente.baixar('1', 'bytes=0-1');
    expect(r.status).toBe(206);
    expect(tokenChamadas).toContainEqual({ renovar: true });
    expect(chamadas[0].headers.get('authorization')).toBe('Bearer VELHO');
    expect(chamadas[1].headers.get('authorization')).toBe('Bearer NOVO');
  });

  it('401 depois da renovação → nao-autorizado', async () => {
    const { cliente, chamadas } = montar([new Response('', { status: 401 }), new Response('', { status: 401 })], {
      token: async () => 'T',
    });
    await expect(cliente.getArquivo('1')).rejects.toMatchObject({ tipo: 'nao-autorizado' });
    expect(chamadas).toHaveLength(2);
  });

  it('baixar repassa Range e o cabeçalho de resource key', async () => {
    const { cliente, chamadas } = montar([new Response('x', { status: 206 })], { resourceKeys: 'abc/rk' });
    await cliente.baixar('ID', 'bytes=10-20');
    expect(chamadas[0].url.searchParams.get('alt')).toBe('media');
    expect(chamadas[0].url.pathname).toBe('/drive/v3/files/ID');
    expect(chamadas[0].headers.get('range')).toBe('bytes=10-20');
    expect(chamadas[0].headers.get('x-goog-drive-resource-keys')).toBe('abc/rk');
  });

  it('baixar devolve 416 sem erro', async () => {
    const { cliente } = montar([new Response('', { status: 416 })]);
    expect((await cliente.baixar('1', 'bytes=999-')).status).toBe(416);
  });
});
