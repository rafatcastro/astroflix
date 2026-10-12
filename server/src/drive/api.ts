import { FalhaDrive, type Fetch } from './tipos';

export interface ArquivoDrive {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  thumbnailLink?: string;
  videoMediaMetadata?: { durationMillis?: string };
  shortcutDetails?: { targetId: string; targetMimeType: string };
  resourceKey?: string;
}

export interface DepsCliente {
  fetch: Fetch;
  apiKey: string | null;
  token: (opts?: { renovar?: boolean }) => Promise<string | null>;
  // Injetável para os testes não dormirem de verdade.
  esperar?: (ms: number) => Promise<void>;
  // Valor de X-Goog-Drive-Resource-Keys: "<id>/<chave>".
  resourceKeys?: string | null;
}

export interface ClienteDrive {
  getArquivo(id: string): Promise<ArquivoDrive>;
  listarFilhos(pastaId: string): Promise<ArquivoDrive[]>;
  baixar(id: string, range: string | undefined, signal?: AbortSignal): Promise<Response>;
}

export const CAMPOS_ARQUIVO =
  'id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,videoMediaMetadata,shortcutDetails,resourceKey';

const BASE = 'https://www.googleapis.com/drive/v3/files';
const MAX_TENTATIVAS = 6;
const RATE_LIMIT = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function motivo(res: Response): Promise<string | undefined> {
  try {
    const corpo = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
    return corpo?.error?.errors?.[0]?.reason;
  } catch {
    return undefined;
  }
}

export function criarClienteDrive(deps: DepsCliente): ClienteDrive {
  const esperar = deps.esperar ?? dormir;

  // O retry cobre só a obtenção da Response: depois que o corpo começa a vir
  // (download), repetir reiniciaria o stream no meio do vídeo.
  async function requisitar(
    url: URL,
    opts: { range?: string; signal?: AbortSignal; aceitar?: number[] } = {},
  ): Promise<Response> {
    const aceitar = opts.aceitar ?? [];
    let renovou = false;
    let renovarAgora = false;
    let tentativa = 0;
    let ultima: FalhaDrive = new FalhaDrive('google');

    while (tentativa < MAX_TENTATIVAS) {
      // A 401 só pode ser contornada se houve token; sem token a chave é a credencial.
      const tok = await deps.token(renovarAgora ? { renovar: true } : undefined);
      renovarAgora = false;
      const u = new URL(url);
      const headers: Record<string, string> = {};
      if (tok) headers.Authorization = `Bearer ${tok}`;
      else if (deps.apiKey) u.searchParams.set('key', deps.apiKey);
      if (opts.range) headers.Range = opts.range;
      if (deps.resourceKeys) headers['X-Goog-Drive-Resource-Keys'] = deps.resourceKeys;

      let falha: FalhaDrive | null = null;
      try {
        const res = await deps.fetch(u, { headers, signal: opts.signal });
        if (res.ok || aceitar.includes(res.status)) return res;

        if (res.status === 401) {
          if (!tok || renovou) throw new FalhaDrive('nao-autorizado', 401);
          // Token expirado no meio do caminho não consome tentativa de rate limit.
          renovou = true;
          renovarAgora = true;
          continue;
        }

        const razao = await motivo(res);
        if (res.status === 429 || res.status >= 500 || (res.status === 403 && razao && RATE_LIMIT.has(razao))) {
          falha = new FalhaDrive('google', res.status);
        } else if (res.status === 403 && razao === 'downloadQuotaExceeded') {
          throw new FalhaDrive('cota-esgotada', 403);
        } else if (res.status === 404 || res.status === 403) {
          throw new FalhaDrive('sem-acesso', res.status);
        } else {
          throw new FalhaDrive('google', res.status);
        }
      } catch (e) {
        if (e instanceof FalhaDrive) throw e;
        // Só TypeError é falha de rede; AbortError e afins sobem como estão.
        if (!(e instanceof TypeError)) throw e;
        falha = new FalhaDrive('sem-conexao');
      }

      ultima = falha;
      tentativa++;
      if (tentativa < MAX_TENTATIVAS) await esperar((2 ** (tentativa - 1) + 1) * 1000);
    }
    throw ultima;
  }

  function urlArquivos(caminho: string, params: Record<string, string>): URL {
    const u = new URL(caminho ? `${BASE}/${encodeURIComponent(caminho)}` : BASE);
    u.searchParams.set('supportsAllDrives', 'true');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
  }

  return {
    async getArquivo(id) {
      const res = await requisitar(urlArquivos(id, { fields: CAMPOS_ARQUIVO }));
      return (await res.json()) as ArquivoDrive;
    },

    async listarFilhos(pastaId) {
      const todos: ArquivoDrive[] = [];
      let pagina: string | undefined;
      do {
        const params: Record<string, string> = {
          includeItemsFromAllDrives: 'true',
          pageSize: '1000',
          q: `'${pastaId}' in parents and trashed=false`,
          fields: `nextPageToken,files(${CAMPOS_ARQUIVO})`,
        };
        if (pagina) params.pageToken = pagina;
        const res = await requisitar(urlArquivos('', params));
        const corpo = (await res.json()) as { nextPageToken?: string; files?: ArquivoDrive[] };
        todos.push(...(corpo.files ?? []));
        pagina = corpo.nextPageToken;
      } while (pagina);
      return todos;
    },

    // 416 volta como Response normal: a rota decide como repassá-lo ao player.
    baixar(id, range, signal) {
      return requisitar(urlArquivos(id, { alt: 'media' }), { range, signal, aceitar: [416] });
    },
  };
}
