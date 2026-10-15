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
  esperar?: (ms: number, signal?: AbortSignal) => Promise<void>;
  // Valor de X-Goog-Drive-Resource-Keys: "<id>/<chave>".
  resourceKeys?: string | null;
}

export interface ClienteDrive {
  getArquivo(id: string): Promise<ArquivoDrive>;
  listarFilhos(pastaId: string): Promise<ArquivoDrive[]>;
  /** Listagem por consulta livre do Drive (o seletor usa `sharedWithMe`). */
  listar(q: string): Promise<ArquivoDrive[]>;
  baixar(id: string, range: string | undefined, signal?: AbortSignal): Promise<Response>;
}

export const CAMPOS_ARQUIVO =
  'id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,videoMediaMetadata,shortcutDetails,resourceKey';

const BASE = 'https://www.googleapis.com/drive/v3/files';
const MAX_TENTATIVAS = 6;
const RATE_LIMIT = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

// Metadados e listagem não devem prender a tela se a rede sumiu sem derrubar a conexão.
const TIMEOUT_MS = 15_000;
// Offline: uma nova tentativa basta. O backoff longo é para rate limit, não para rede caída.
const ESPERA_REDE_MS = 1000;

// Respeita o signal: fechar a aba durante a espera não pode deixar o pedido dormindo.
export const dormir = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', aoAbortar);
      resolve();
    }, ms);
    const aoAbortar = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', aoAbortar, { once: true });
  });

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
    opts: { range?: string; signal?: AbortSignal; aceitar?: number[]; semTimeout?: boolean } = {},
  ): Promise<Response> {
    const aceitar = opts.aceitar ?? [];
    let renovou = false;
    let renovarAgora = false;
    let tentativa = 0;
    let falhasDeRede = 0;
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
        // O download não leva timeout: o corpo de um vídeo pode legitimamente levar minutos.
        const sinais = [opts.signal, opts.semTimeout ? undefined : AbortSignal.timeout(TIMEOUT_MS)].filter(
          (x): x is AbortSignal => !!x,
        );
        const signal = sinais.length > 1 ? AbortSignal.any(sinais) : sinais[0];
        const res = await deps.fetch(u, { headers, signal });
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
        // TypeError é falha de rede e TimeoutError é o nosso prazo estourado; AbortError
        // (quem chamou desistiu) e afins sobem como estão.
        const timeout = (e as Error)?.name === 'TimeoutError' && !opts.signal?.aborted;
        if (!(e instanceof TypeError) && !timeout) throw e;
        // Offline repete uma vez só: esperar 36-72 s para dizer "sem conexão" era pior que o erro.
        if (falhasDeRede++ >= 1) throw new FalhaDrive('sem-conexao');
        await esperar(ESPERA_REDE_MS, opts.signal);
        continue;
      }

      ultima = falha;
      tentativa++;
      if (tentativa < MAX_TENTATIVAS) await esperar((2 ** (tentativa - 1) + 1) * 1000, opts.signal);
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

    listarFilhos(pastaId) {
      return this.listar(`'${pastaId}' in parents and trashed=false`);
    },

    async listar(q) {
      const todos: ArquivoDrive[] = [];
      let pagina: string | undefined;
      do {
        const params: Record<string, string> = {
          includeItemsFromAllDrives: 'true',
          pageSize: '1000',
          q,
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
      return requisitar(urlArquivos(id, { alt: 'media' }), { range, signal, aceitar: [416], semTimeout: true });
    },
  };
}
