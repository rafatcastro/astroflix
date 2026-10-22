export interface CourseSummary {
  id: string; title: string; structure: 'modules' | 'flat';
  totalLessons: number; completedLessons: number; inProgressLessons: number;
  posterLessonId: string | null; lastActivityAt: string | null;
  collectionId: string | null;
  source: 'local' | 'drive' | 'telegram';
  carregando: boolean;
  // Onde a pessoa parou (aula mexida mais recentemente e não concluída).
  ultimaAula: { id: string; titulo: string; posicaoSec: number; duracaoSec: number | null } | null;
  // 0–100 por tempo assistido; null se nenhuma aula tem duração conhecida.
  progressoReal: number | null;
}
export interface LessonDTO {
  id: string; title: string; module: string | null; relPath: string;
  orderIndex: number; durationSec: number | null; container: string;
  playable: boolean; missing: boolean;
  position: number; furthest: number; completed: boolean;
  progressUpdatedAt: string | null;
  /** Está na pasta de armazenamento (curso local: sempre). Fora dela, a aula toca pela rede. */
  baixada?: boolean;
}
export interface LessonFull extends LessonDTO {
  courseId: string; courseTitle: string; courseSource: 'local' | 'drive' | 'telegram';
  prevLessonId: string | null; nextLessonId: string | null;
}
export interface ModuleDTO { name: string | null; lessons: LessonDTO[]; }
export type MaterialKind = 'pdf' | 'zip' | 'archive' | 'doc' | 'image' | 'other';
export interface MaterialDTO { id: string; module: string | null; relPath: string; name: string; kind: MaterialKind; sizeBytes: number; }
export interface CourseDetail {
  id: string; title: string; structure: 'modules' | 'flat'; rootPath: string;
  totalLessons: number; completedLessons: number; materialsCount: number;
  modules: ModuleDTO[];
  materials: MaterialDTO[];
  collectionId: string | null;
  source: 'local' | 'drive' | 'telegram';
  // Pasta do Drive recém-colada: lida em segundo plano, as aulas vão entrando.
  importacao: { carregando: boolean; erro: string | null } | null;
  // Curso do Drive ou do Telegram: aulas na pasta de armazenamento e se a aula aberta e as próximas estão baixando.
  download: { total: number; baixadas: number; ativo: boolean; erro: string | null } | null;
  /** O "Baixar" (só Drive e Telegram); null = não pedido desde que o app abriu. */
  downloadCurso: DownloadCurso | null;
  /** Bytes do curso inteiro (aulas e materiais), para o diálogo do "Baixar". */
  tamanhoRemoto: number | null;
  /** A pasta da pessoa conectada a este curso ("Conectar a uma pasta"): o app só acrescenta nela. */
  pastaConectada?: string | null;
}
export interface DownloadCurso {
  courseId: string;
  titulo: string;
  origem: 'drive' | 'telegram';
  ativo: boolean;
  /** Pedido, esperando outro curso terminar. */
  naFila: boolean;
  cancelado: boolean;
  /** O arquivo sendo baixado agora. */
  arquivo: string | null;
  /** Bytes por segundo nos últimos segundos; null antes de dar para medir. */
  velocidade: number | null;
  feitos: number;
  total: number;
  bytesFeitos: number;
  bytesTotal: number;
  erro: string | null;
  /** Parou por uma falha que passa sozinha: quando tenta de novo (ms desde 1970), ou null. */
  tentarEm: number | null;
  pasta: string;
}
/** A pasta onde ficam as aulas e materiais baixados (Configurações → Armazenamento). */
export interface Armazenamento {
  pasta: string;
  /** É a pasta padrão do app (DATA_DIR/downloads). */
  padrao: boolean;
  bytes: number;
  /** Espaço livre no disco da pasta; null se não deu para medir. */
  livre: number | null;
  cursos: Array<{ courseId: string; titulo: string; bytes: number; arquivos: number; pasta: string | null }>;
}
// Flashcards (ver server/src/anki). `noAnki` = já chegou ao Anki e não há nada pendente.
export interface Flashcard {
  id: string;
  courseId: string | null; courseTitle: string | null;
  lessonId: string | null; lessonTitle: string | null;
  minutoSec: number | null;
  documentoId: string | null; documentoTitulo: string | null; pagina: number | null;
  categoriaId: string | null;
  /** Onde o card mora no Anki (Astroflix::<categoria>[::Cursos|PDFs::<título>]). */
  baralho: string;
  frente: string; verso: string;
  noAnki: boolean;
  criadoEm: string;
}
export type EstadoAnki = 'conectado' | 'fechado' | 'erro';
export interface ListaFlashcards { cards: Flashcard[]; anki: EstadoAnki; pendentes: number; }
/** `categoria`: id da categoria ou 'sem'. */
export type FiltroFlashcards =
  | { lessonId: string } | { courseId: string } | { documentoId: string } | { categoria: string } | { geral: true }
  | Record<string, never>;
export interface NovoFlashcard {
  frente: string; verso: string; courseId?: string; lessonId?: string; minutoSec?: number;
  documentoId?: string; pagina?: number; categoriaId?: string;
}
const qsFlashcards = (f: FiltroFlashcards): string =>
  'lessonId' in f ? `?lessonId=${encodeURIComponent(f.lessonId)}`
  : 'courseId' in f ? `?courseId=${encodeURIComponent(f.courseId)}`
  : 'documentoId' in f ? `?documentoId=${encodeURIComponent(f.documentoId)}`
  : 'categoria' in f ? `?categoria=${encodeURIComponent(f.categoria)}`
  : 'geral' in f ? '?geral=1' : '';

// PDFs (ver server/src/routes/documentos.ts). `disponivel` = o arquivo está nesta
// máquina; um PDF que veio da conta, de outro computador, chega sem ele.
export interface Documento {
  id: string; titulo: string; caminho: string; tamanho: number;
  /** Livros, Questões, Apostilas… (filtro dentro da aba PDFs). */
  tipo: string | null;
  /** 'drive': lido direto do Google Drive, sem arquivo nesta máquina. */
  origem: 'local' | 'drive';
  categoriaId: string | null;
  paginas: number | null; pagina: number; lido: boolean; lidoEm: string | null;
  leituraEm: string | null; criadoEm: string; disponivel: boolean; temCapa: boolean;
}
export interface ResultadoAdicionarPdfs { criados: number; jaExistiam: number; recusados: number; ids: string[]; }

// Conta (login obrigatório) e o estado da sincronização com a nuvem.
export interface Conta {
  configurada: boolean;
  entrou: boolean;
  email: string | null;
  nuvem: {
    sincronizando: boolean;
    ultimaSincronizacao: string | null;
    pendentes: number;
    erro: 'sem-conexao' | 'sessao-expirada' | 'recusado' | null;
  } | null;
}

export const materialUrl = (id: string, download = false) => `/api/materials/${id}${download ? '?download=1' : ''}`;
export interface DirEntry { name: string; path: string; }
export interface BrowseResult { path: string | null; parent: string | null; dirs: DirEntry[]; }
export interface RepointSummary { matched: number; relinked: number; missing: number; added: number; structureChanged: boolean; }
export interface RootUnavailable { status: 'root_unavailable'; }
export interface Settings { allowedRootsExtra: string[]; }
// Categoria (a API ainda diz collection: eram as bibliotecas de cursos).
export interface Collection {
  id: string; name: string; emoji: string | null; courseCount: number; pdfCount: number; acessadoEm: string | null;
}
export interface BatchImportResult {
  created: number; skipped: number; noVideos: number;
  courses: { id: string; title: string }[];
  skippedTitles: string[];   // já eram cursos
  noVideosTitles: string[];  // pastas sem nenhum vídeo
  unreadable: number;        // listados pela pasta, mas o sistema não entregou
  unreadableSample: string[];
}
export interface CourseRoot { id: string; path: string; createdAt: string; lastCheckedAt: string | null; }
// O que uma importação faria (prévia) ou fez (resumo) — é o mesmo cálculo dos dois lados.
export interface ImportPlan {
  created: number;              // cursos que entram
  merged: number;               // cursos que já existem e terão o progresso fundido
  missingFolder: number;
  missingFolderTitles: string[];
  collectionsCreated: number;
  lessonsWithProgress: number;
  newRoots: string[];           // pastas que o arquivo libera para o app ler
  driveAusentes: string[];      // cursos do Drive ou do Telegram do arquivo que não existem aqui
}
// semArquivo: aula do Drive/Telegram que ainda não chegou ao disco (não há o que converter ainda).
export type PlaybackVerdict = { playable: true } | { playable: false; reason: 'container' | 'codec'; remuxable: boolean; semArquivo?: boolean };
export type ConvertResult = { status: 'converted' | 'already_playable' | 'transcoding' };
export type ConvertStatus =
  | { status: 'idle' | 'converted' }
  | { status: 'transcoding'; progresso: number }
  | { status: 'failed'; error: string };

// O que o player desta janela decodifica, perguntado a ele mesmo: o WebKit do
// macOS toca HEVC, a webview do Windows só com a extensão instalada. Supor o
// pior (como num Chrome) mandava converter vídeo que já tocava.
export const tocaHevc = (() => {
  try {
    return document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '';
  } catch {
    return false;
  }
})();
const capacidades = tocaHevc ? '?hevc=1' : '';

// Só declara Content-Type: application/json quando há corpo — um POST/DELETE sem corpo
// com esse header faz o Fastify rejeitar com FST_ERR_CTP_EMPTY_JSON_BODY (400).
async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let payload: { error?: string } | undefined;
    try {
      payload = (await res.json()) as { error?: string } | undefined;
    } catch {
      payload = undefined;
    }
    throw new Error(payload?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// Rotas de migração respondem 409 com { status: 'root_unavailable' } (pasta indisponível / curso inexistente).
// Tratamos o 409 como resposta válida para que o ramo RootUnavailable seja narrável por 'status' in res.
async function migrationFetch(url: string, init?: RequestInit): Promise<RepointSummary | RootUnavailable> {
  const headers = init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers;
  const res = await fetch(url, { ...init, headers });
  if (res.status === 409) return (await res.json()) as RootUnavailable;
  if (!res.ok) {
    // O código do erro (sem-acesso, flood…) vai na mensagem, para o menu explicar a falha do Telegram.
    const j = (await res.json().catch(() => null)) as { error?: string; esperaSeg?: number } | null;
    throw Object.assign(new Error(j?.error ?? `${res.status} ${res.statusText}`), { esperaSeg: j?.esperaSeg });
  }
  return (await res.json()) as RepointSummary;
}

export type CredencialDrive = 'clientId' | 'clientSecret' | 'apiKey';
export interface DriveStatus { conectado: boolean; email: string | null; credenciais: Record<CredencialDrive, boolean>; }
export type RespostaDrive =
  | { tipo: 'criado'; id: string; existente: boolean }
  | { tipo: 'autorizar'; url: string }
  | { tipo: 'erro'; erro: string };

// Falhas do Drive (sem acesso, cota, sem credenciais…) são resultados esperados que a interface
// explica à pessoa; por isso voltam como valor em vez de exceção do jsonFetch.
export interface ItemDrive { id: string; nome: string; tipo: 'pasta' | 'pdf'; resourceKey: string | null; tamanho: number; }
export type RespostaNavegarDrive = { tipo: 'itens'; itens: ItemDrive[] } | { tipo: 'autorizar'; url: string } | { tipo: 'erro'; erro: string };

/** Uma pasta do Drive para o seletor: 'root' (Meu Drive), 'compartilhados' ou o id. */
async function driveNavegar(pasta: string): Promise<RespostaNavegarDrive> {
  let res: Response;
  try {
    res = await fetch(`/api/drive/navegar?pasta=${encodeURIComponent(pasta)}`);
  } catch {
    return { tipo: 'erro', erro: 'sem-conexao' };
  }
  const corpo = (await res.json().catch(() => ({}))) as { itens?: ItemDrive[]; precisaAutorizar?: boolean; url?: string; error?: string };
  if (res.ok && corpo.itens) return { tipo: 'itens', itens: corpo.itens };
  if (res.status === 401 && corpo.precisaAutorizar && corpo.url) return { tipo: 'autorizar', url: corpo.url };
  return { tipo: 'erro', erro: corpo.error ?? 'google' };
}

export type RespostaDrivePdfs =
  | { tipo: 'pdfs'; resultado: ResultadoAdicionarPdfs }
  | { tipo: 'autorizar'; url: string }
  | { tipo: 'erro'; erro: string };

// PDFs de um link do Drive (o arquivo, ou todos os da pasta). Mesmo contrato do curso.
async function adicionarPdfsDoDrive(link: string, categoriaId?: string): Promise<RespostaDrivePdfs> {
  let res: Response;
  try {
    res = await fetch('/api/documentos/drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link, categoriaId }),
    });
  } catch {
    return { tipo: 'erro', erro: 'sem-conexao' };
  }
  let corpo: Partial<ResultadoAdicionarPdfs> & { precisaAutorizar?: boolean; url?: string; error?: string } = {};
  try {
    corpo = (await res.json()) as typeof corpo;
  } catch {
    // corpo ilegível: cai no erro genérico abaixo
  }
  if (res.ok && corpo.ids) return { tipo: 'pdfs', resultado: corpo as ResultadoAdicionarPdfs };
  if (res.status === 401 && corpo.precisaAutorizar && corpo.url) return { tipo: 'autorizar', url: corpo.url };
  return { tipo: 'erro', erro: corpo.error ?? 'google' };
}

async function driveCriarCurso(link: string): Promise<RespostaDrive> {
  let res: Response;
  try {
    res = await fetch('/api/drive/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });
  } catch {
    return { tipo: 'erro', erro: 'sem-conexao' };
  }
  let corpo: { id?: string; existente?: boolean; precisaAutorizar?: boolean; url?: string; error?: string } = {};
  try {
    corpo = (await res.json()) as typeof corpo;
  } catch {
    // corpo ilegível: cai no erro genérico abaixo
  }
  if (res.ok && corpo.id) return { tipo: 'criado', id: corpo.id, existente: !!corpo.existente };
  if (res.status === 401 && corpo.precisaAutorizar && corpo.url) return { tipo: 'autorizar', url: corpo.url };
  return { tipo: 'erro', erro: corpo.error ?? 'google' };
}

export interface TelegramStatus { conectado: boolean; usuario: string | null; credenciais: { apiId: boolean; apiHash: boolean }; }
export type EstadoLoginTelegram =
  | { fase: 'parado' }
  | { fase: 'qr'; url: string; expiraEm: number }
  | { fase: 'senha'; dica: string | null; erro: 'senha-incorreta' | null }
  | { fase: 'conectado'; usuario: string | null }
  | { fase: 'erro'; erro: string };
export type RespostaTelegram =
  | { tipo: 'criado'; id: string; existente: boolean }
  | { tipo: 'conectar' }
  | { tipo: 'convite'; titulo: string }
  | { tipo: 'erro'; erro: string; esperaSeg?: number };

/** O grupo antes de virar curso. Convite de grupo em que a pessoa não está: sem contagem (null). */
/** Uma conversa da conta (grupo, canal ou bot) que pode virar curso. */
export interface DialogoTelegram {
  /** O que vai no lugar do link na prévia e na criação. */
  chave: string;
  titulo: string;
  tipo: 'canal' | 'grupo' | 'bot';
  membros: number | null;
  cursoId: string | null;
}
export type RespostaDialogos = { tipo: 'lista'; itens: DialogoTelegram[] } | { tipo: 'conectar' } | { tipo: 'erro'; erro: string; esperaSeg?: number };

export interface PreviaTelegram {
  titulo: string;
  canal: boolean;
  bot?: boolean;
  membros: number | null;
  /** data: URL da miniatura, ou null (a interface mostra a inicial). */
  foto: string | null;
  videos: number | null;
  arquivos: number | null;
  fotos?: number | null;
  convite: boolean;
  /** O grupo já é um curso da biblioteca. */
  cursoId: string | null;
}
export type RespostaPrevia =
  | { tipo: 'previa'; previa: PreviaTelegram }
  | { tipo: 'conectar' }
  | { tipo: 'erro'; erro: string; esperaSeg?: number };

type CorpoTelegram = {
  id?: string; existente?: boolean; precisaConectar?: boolean; convite?: boolean; titulo?: string; error?: string; esperaSeg?: number;
};

// Como no Drive: falhas esperadas (sem conta, convite, sem acesso…) voltam como valor, para a
// interface explicar em vez de mostrar um erro genérico.
async function postarLink(url: string, link: string, signal?: AbortSignal): Promise<{ res: Response; corpo: CorpoTelegram } | null> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }), signal });
  } catch {
    return null;
  }
  let corpo: CorpoTelegram = {};
  try {
    corpo = (await res.json()) as CorpoTelegram;
  } catch {
    // corpo ilegível: cai no erro genérico de quem chamou
  }
  return { res, corpo };
}

async function telegramPost(url: string, link: string): Promise<RespostaTelegram> {
  const r = await postarLink(url, link);
  if (!r) return { tipo: 'erro', erro: 'sem-conexao' };
  const { res, corpo } = r;
  if (res.ok && corpo.id) return { tipo: 'criado', id: corpo.id, existente: !!corpo.existente };
  if (res.status === 401 && corpo.precisaConectar) return { tipo: 'conectar' };
  if (res.status === 409 && corpo.convite) return { tipo: 'convite', titulo: corpo.titulo ?? '' };
  return { tipo: 'erro', erro: corpo.error ?? 'telegram', esperaSeg: corpo.esperaSeg };
}

async function telegramPrevia(link: string, signal?: AbortSignal): Promise<RespostaPrevia> {
  const r = await postarLink('/api/telegram/previa', link, signal);
  if (!r) return { tipo: 'erro', erro: 'sem-conexao' };
  const { res, corpo } = r;
  if (res.ok) return { tipo: 'previa', previa: corpo as unknown as PreviaTelegram };
  if (res.status === 401 && corpo.precisaConectar) return { tipo: 'conectar' };
  return { tipo: 'erro', erro: corpo.error ?? 'telegram', esperaSeg: corpo.esperaSeg };
}

async function telegramDialogos(signal?: AbortSignal): Promise<RespostaDialogos> {
  try {
    const res = await fetch('/api/telegram/dialogos', { signal });
    const corpo = (await res.json().catch(() => ({}))) as { error?: string; esperaSeg?: number; precisaConectar?: boolean } | DialogoTelegram[];
    if (res.ok && Array.isArray(corpo)) return { tipo: 'lista', itens: corpo };
    const c = corpo as { error?: string; esperaSeg?: number; precisaConectar?: boolean };
    if (res.status === 401 && c.precisaConectar) return { tipo: 'conectar' };
    return { tipo: 'erro', erro: c.error ?? 'telegram', esperaSeg: c.esperaSeg };
  } catch {
    return { tipo: 'erro', erro: 'sem-conexao' };
  }
}

export interface NumerosEstudo { pomodoros: number; segundosAula: number }
export interface PeriodoEstudo extends NumerosEstudo {
  /** Pelo id da categoria ('sem' = sem categoria). */
  porCategoria: Record<string, NumerosEstudo>;
}
export interface ResumoEstudo {
  hoje: PeriodoEstudo;
  semana: PeriodoEstudo;
  mes: PeriodoEstudo;
  total: PeriodoEstudo;
  /** O de hoje (o mesmo de hoje.porCategoria). */
  porCategoria: Record<string, NumerosEstudo>;
}

export const api = {
  estudoResumo: () => jsonFetch<ResumoEstudo>('/api/estudo/resumo'),
  registrarPomodoro: (b: { categoriaId: string | null; inicio: string; fim: string; minutos: number }) =>
    jsonFetch<{ id: string }>('/api/estudo/pomodoros', { method: 'POST', body: JSON.stringify(b) }),
  // keepalive: o último pedaço vai ao sair da aula, quando a página já está desmontando.
  registrarTempoAula: (lessonId: string, segundos: number) =>
    fetch('/api/estudo/aula', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId, segundos }),
    }).then(() => undefined, () => undefined),
  listarDocumentos: (categoria?: string) =>
    jsonFetch<Documento[]>(`/api/documentos${categoria ? `?categoria=${encodeURIComponent(categoria)}` : ''}`),
  documento: (id: string) => jsonFetch<Documento>(`/api/documentos/${id}`),
  adicionarPdfs: (body: { caminhos?: string[]; pasta?: string; tipo?: string | null; categoriaId?: string | null }) =>
    jsonFetch<ResultadoAdicionarPdfs>('/api/documentos', { method: 'POST', body: JSON.stringify(body) }),
  editarDocumento: (
    id: string,
    body: { titulo?: string; tipo?: string | null; categoriaId?: string | null; pagina?: number; paginas?: number; lido?: boolean },
  ) =>
    jsonFetch<Documento>(`/api/documentos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  reapontarDocumento: (id: string, caminho: string) =>
    jsonFetch<Documento>(`/api/documentos/${id}/caminho`, { method: 'POST', body: JSON.stringify({ caminho }) }),
  removerDocumento: (id: string) => jsonFetch<void>(`/api/documentos/${id}`, { method: 'DELETE' }),
  documentoArquivoUrl: (id: string) => `/api/documentos/${id}/arquivo`,
  documentoCapaUrl: (id: string, v?: string) => `/api/documentos/${id}/capa${v ? `?v=${encodeURIComponent(v)}` : ''}`,
  async salvarCapaDocumento(id: string, png: Blob): Promise<void> {
    const res = await fetch(`/api/documentos/${id}/capa`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
    if (!res.ok) throw new Error(`${res.status}`);
  },
  listCourses: (archived?: boolean) => jsonFetch<CourseSummary[]>(`/api/courses${archived ? '?archived=1' : ''}`),
  getCourse: (id: string) => jsonFetch<CourseDetail>(`/api/courses/${id}`),
  createCourse: (path: string) => jsonFetch<{ id: string; existing?: boolean }>('/api/courses', { method: 'POST', body: JSON.stringify({ path }) }),
  inspect: (path: string) => jsonFetch<{ videosNaRaiz: boolean; subpastasComVideo: number }>(`/api/fs/inspect?path=${encodeURIComponent(path)}`),
  browse: (path?: string) => jsonFetch<BrowseResult>(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  getLesson: (id: string) => jsonFetch<LessonFull>(`/api/lessons/${id}`),
  saveProgress: (id: string, body: { position_sec: number; furthest_sec: number; duration_sec: number | null }) =>
    jsonFetch<void>(`/api/lessons/${id}/progress`, { method: 'PATCH', body: JSON.stringify(body) }),
  setComplete: (id: string, completed: boolean) =>
    jsonFetch<void>(`/api/lessons/${id}/complete`, { method: 'POST', body: JSON.stringify({ completed }) }),
  lessonThumbUrl: (id: string) => `/api/lessons/${id}/thumb`,
  courseCoverUrl: (id: string, v?: number) => `/api/courses/${id}/cover${v ? `?v=${v}` : ''}`,
  getInfo: () => jsonFetch<{ ffmpeg: boolean; version?: string }>('/api/info'),
  setCover: (courseId: string, lessonId: string, atSec: number) =>
    jsonFetch<void>(`/api/courses/${courseId}/cover`, { method: 'POST', body: JSON.stringify({ lessonId, atSec }) }),
  repointPreview: (id: string, path: string) =>
    migrationFetch(`/api/courses/${id}/repoint/preview`, { method: 'POST', body: JSON.stringify({ path }) }),
  repoint: (id: string, path: string) =>
    migrationFetch(`/api/courses/${id}/repoint`, { method: 'POST', body: JSON.stringify({ path }) }),
  rescan: (id: string) =>
    migrationFetch(`/api/courses/${id}/rescan`, { method: 'POST' }),
  patchCourse: (id: string, body: { title?: string; archived?: boolean; collectionId?: string | null }) =>
    jsonFetch<{ ok: true }>(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCourse: (id: string) => jsonFetch<void>(`/api/courses/${id}`, { method: 'DELETE' }),
  baixarCurso: (id: string) => jsonFetch<DownloadCurso>(`/api/courses/${id}/baixar`, { method: 'POST' }),
  cancelarDownloadCurso: (id: string) => jsonFetch<void>(`/api/courses/${id}/baixar`, { method: 'DELETE' }),
  baixarAula: (id: string) => jsonFetch<void>(`/api/lessons/${id}/baixar`, { method: 'POST' }),
  conectarPasta: (id: string, pasta: string) =>
    jsonFetch<{ pasta: string; adotados: number; total: number; baixadas: number }>(`/api/courses/${id}/pasta`, {
      method: 'PUT',
      body: JSON.stringify({ pasta }),
    }),
  desconectarPasta: (id: string) => jsonFetch<void>(`/api/courses/${id}/pasta`, { method: 'DELETE' }),
  excluirDownloadAula: (id: string) => jsonFetch<void>(`/api/lessons/${id}/baixado`, { method: 'DELETE' }),
  removerBaixados: (id: string) => jsonFetch<void>(`/api/courses/${id}/baixados`, { method: 'DELETE' }),
  baixarCategoria: (cat: string) => jsonFetch<{ cursos: number }>(`/api/collections/${cat}/baixar`, { method: 'POST' }),
  listarDownloads: () => jsonFetch<{ itens: DownloadCurso[] }>('/api/downloads'),
  dispensarDownload: (id: string) => jsonFetch<void>(`/api/downloads/${id}`, { method: 'DELETE' }),
  cancelarDownloadCategoria: (cat: string) => jsonFetch<void>(`/api/collections/${cat}/baixar`, { method: 'DELETE' }),
  armazenamento: () => jsonFetch<Armazenamento>('/api/armazenamento'),
  /** null = volta à pasta padrão. */
  trocarArmazenamento: (pasta: string | null) => jsonFetch<Armazenamento>('/api/armazenamento', { method: 'PUT', body: JSON.stringify({ pasta }) }),
  abrirArmazenamento: (courseId?: string) =>
    jsonFetch<void>('/api/armazenamento/abrir', { method: 'POST', body: JSON.stringify(courseId ? { courseId } : {}) }),
  limparArmazenamento: () => jsonFetch<Armazenamento>('/api/armazenamento', { method: 'DELETE' }),
  getSettings: () => jsonFetch<Settings>('/api/settings'),
  patchSettings: (body: Settings) => jsonFetch<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  verifyPlayback: (id: string) => jsonFetch<PlaybackVerdict>(`/api/lessons/${id}/verify-playback${capacidades}`, { method: 'POST' }),
  // 202 = recodificação começou em segundo plano; acompanhe por convertStatus.
  convertLesson: (id: string) => jsonFetch<ConvertResult>(`/api/lessons/${id}/convert${capacidades}`, { method: 'POST' }),
  salvarCapacidades: (cap: { hevc: boolean }) =>
    jsonFetch<void>('/api/player/capacidades', { method: 'PUT', body: JSON.stringify(cap) }),
  convertStatus: (id: string) => jsonFetch<ConvertStatus>(`/api/lessons/${id}/convert`),
  resetCourseProgress: (id: string) => jsonFetch<{ deleted: number }>(`/api/courses/${id}/progress/reset`, { method: 'POST' }),
  resetAllProgress: () => jsonFetch<{ deleted: number }>('/api/progress/reset', { method: 'POST' }),
  resetLibrary: () => jsonFetch<{ courses: number }>('/api/library/reset', { method: 'POST' }),
  listCollections: () => jsonFetch<Collection[]>('/api/collections'),
  /** `adotarSemCategoria`: o que está sem categoria (cursos, PDFs, questões gerais) vai para a nova. */
  createCollection: (name: string, emoji?: string | null, adotarSemCategoria = false) =>
    jsonFetch<{ id: string; name: string }>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ name, emoji: emoji ?? null, adotarSemCategoria }),
    }),
  editarCategoria: (id: string, body: { name?: string; emoji?: string | null }) =>
    jsonFetch<{ ok: true }>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  renameCollection: (id: string, name: string) => jsonFetch<{ ok: true }>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCollection: (id: string) => jsonFetch<void>(`/api/collections/${id}`, { method: 'DELETE' }),
  acessarCategoria: (id: string) => jsonFetch<void>(`/api/collections/${id}/acesso`, { method: 'POST' }),
  baralho: (q: { categoria?: string; courseId?: string; documentoId?: string }) =>
    jsonFetch<{ baralho: string }>(`/api/anki/baralho?${new URLSearchParams(q as Record<string, string>)}`),
  batchImport: (path: string) => jsonFetch<BatchImportResult>('/api/courses/batch', { method: 'POST', body: JSON.stringify({ path }) }),
  listCourseRoots: () => jsonFetch<CourseRoot[]>('/api/courses/roots'),
  deleteCourseRoot: (id: string) => jsonFetch<void>(`/api/courses/roots/${id}`, { method: 'DELETE' }),
  // Link direto em vez de fetch + blob: o servidor já manda o Content-Disposition
  // com o nome datado, então o navegador baixa sozinho — e o <a> ainda vem com
  // teclado e menu de contexto de graça.
  exportLibraryUrl: '/api/library/export',
  importPreview: (data: unknown) =>
    jsonFetch<ImportPlan>('/api/library/import/preview', { method: 'POST', body: JSON.stringify(data) }),
  conta: () => jsonFetch<Conta>('/api/conta'),
  contaLogin: () => jsonFetch<{ url: string }>('/api/conta/login', { method: 'POST' }),
  contaSincronizar: () => jsonFetch<Conta['nuvem']>('/api/conta/sincronizar', { method: 'POST' }),
  contaSair: () => jsonFetch<void>('/api/conta/sair', { method: 'POST' }),
  listarFlashcards: (f: FiltroFlashcards) => jsonFetch<ListaFlashcards>(`/api/flashcards${qsFlashcards(f)}`),
  criarFlashcard: (c: NovoFlashcard) =>
    jsonFetch<{ card: Flashcard; anki: EstadoAnki }>('/api/flashcards', { method: 'POST', body: JSON.stringify(c) }),
  editarFlashcard: (id: string, c: { frente: string; verso: string }) =>
    jsonFetch<{ card: Flashcard; anki: EstadoAnki }>(`/api/flashcards/${id}`, { method: 'PATCH', body: JSON.stringify(c) }),
  apagarFlashcard: (id: string) => jsonFetch<{ anki: EstadoAnki }>(`/api/flashcards/${id}`, { method: 'DELETE' }),
  ankiStatus: () => jsonFetch<{ estado: EstadoAnki; pendentes: number }>('/api/anki/status'),
  driveCriarCurso,
  adicionarPdfsDoDrive,
  driveNavegar,
  driveStatus: () => jsonFetch<DriveStatus>('/api/drive/status'),
  driveDesconectar: () => jsonFetch<void>('/api/drive/auth', { method: 'DELETE' }),
  telegramCriarCurso: (link: string) => telegramPost('/api/telegram/courses', link),
  telegramEntrarConvite: (link: string) => telegramPost('/api/telegram/convite', link),
  telegramPrevia,
  telegramDialogos,
  telegramStatus: () => jsonFetch<TelegramStatus>('/api/telegram/status'),
  telegramIniciarLogin: () => jsonFetch<EstadoLoginTelegram>('/api/telegram/login', { method: 'POST' }),
  telegramEstadoLogin: () => jsonFetch<EstadoLoginTelegram>('/api/telegram/login'),
  telegramSenha: (senha: string) =>
    jsonFetch<EstadoLoginTelegram>('/api/telegram/login/senha', { method: 'POST', body: JSON.stringify({ senha }) }),
  telegramCancelarLogin: () => jsonFetch<void>('/api/telegram/login', { method: 'DELETE' }),
  telegramDesconectar: () => jsonFetch<void>('/api/telegram/auth', { method: 'DELETE' }),
  driveIniciarAuth: () => jsonFetch<{ url: string }>('/api/drive/auth/iniciar', { method: 'POST' }),
  importLibrary: (data: unknown) =>
    jsonFetch<ImportPlan>('/api/library/import', { method: 'POST', body: JSON.stringify(data) }),
};
