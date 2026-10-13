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
  // Cópia local do curso do Drive: aulas no disco e se o download continua.
  download: { total: number; baixadas: number; ativo: boolean; erro: string | null } | null;
}
// Flashcards (ver server/src/anki). `noAnki` = já chegou ao Anki e não há nada pendente.
export interface Flashcard {
  id: string;
  courseId: string | null; courseTitle: string | null;
  lessonId: string | null; lessonTitle: string | null;
  minutoSec: number | null;
  frente: string; verso: string;
  noAnki: boolean;
  criadoEm: string;
}
export type EstadoAnki = 'conectado' | 'fechado' | 'erro';
export interface ListaFlashcards { cards: Flashcard[]; anki: EstadoAnki; pendentes: number; }
export type FiltroFlashcards = { lessonId: string } | { courseId: string } | { geral: true } | Record<string, never>;
export interface NovoFlashcard { frente: string; verso: string; courseId?: string; lessonId?: string; minutoSec?: number; }
const qsFlashcards = (f: FiltroFlashcards): string =>
  'lessonId' in f ? `?lessonId=${encodeURIComponent(f.lessonId)}`
  : 'courseId' in f ? `?courseId=${encodeURIComponent(f.courseId)}`
  : 'geral' in f ? '?geral=1' : '';

export const materialUrl = (id: string, download = false) => `/api/materials/${id}${download ? '?download=1' : ''}`;
export interface DirEntry { name: string; path: string; }
export interface BrowseResult { path: string | null; parent: string | null; dirs: DirEntry[]; }
export interface RepointSummary { matched: number; relinked: number; missing: number; added: number; structureChanged: boolean; }
export interface RootUnavailable { status: 'root_unavailable'; }
export interface Settings { allowedRootsExtra: string[]; }
export interface Collection { id: string; name: string; courseCount: number; }
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
export type PlaybackVerdict = { playable: true } | { playable: false; reason: 'container' | 'codec'; remuxable: boolean };
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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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

// Como no Drive: falhas esperadas (sem conta, convite, sem acesso…) voltam como valor, para a
// interface explicar em vez de mostrar um erro genérico.
async function telegramPost(url: string, link: string): Promise<RespostaTelegram> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }) });
  } catch {
    return { tipo: 'erro', erro: 'sem-conexao' };
  }
  let corpo: { id?: string; existente?: boolean; precisaConectar?: boolean; convite?: boolean; titulo?: string; error?: string; esperaSeg?: number } = {};
  try {
    corpo = (await res.json()) as typeof corpo;
  } catch {
    // corpo ilegível: cai no erro genérico abaixo
  }
  if (res.ok && corpo.id) return { tipo: 'criado', id: corpo.id, existente: !!corpo.existente };
  if (res.status === 401 && corpo.precisaConectar) return { tipo: 'conectar' };
  if (res.status === 409 && corpo.convite) return { tipo: 'convite', titulo: corpo.titulo ?? '' };
  return { tipo: 'erro', erro: corpo.error ?? 'telegram', esperaSeg: corpo.esperaSeg };
}

export const api = {
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
  createCollection: (name: string) => jsonFetch<{ id: string; name: string }>('/api/collections', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCollection: (id: string, name: string) => jsonFetch<{ ok: true }>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCollection: (id: string) => jsonFetch<void>(`/api/collections/${id}`, { method: 'DELETE' }),
  batchImport: (path: string) => jsonFetch<BatchImportResult>('/api/courses/batch', { method: 'POST', body: JSON.stringify({ path }) }),
  listCourseRoots: () => jsonFetch<CourseRoot[]>('/api/courses/roots'),
  deleteCourseRoot: (id: string) => jsonFetch<void>(`/api/courses/roots/${id}`, { method: 'DELETE' }),
  // Link direto em vez de fetch + blob: o servidor já manda o Content-Disposition
  // com o nome datado, então o navegador baixa sozinho — e o <a> ainda vem com
  // teclado e menu de contexto de graça.
  exportLibraryUrl: '/api/library/export',
  importPreview: (data: unknown) =>
    jsonFetch<ImportPlan>('/api/library/import/preview', { method: 'POST', body: JSON.stringify(data) }),
  listarFlashcards: (f: FiltroFlashcards) => jsonFetch<ListaFlashcards>(`/api/flashcards${qsFlashcards(f)}`),
  criarFlashcard: (c: NovoFlashcard) =>
    jsonFetch<{ card: Flashcard; anki: EstadoAnki }>('/api/flashcards', { method: 'POST', body: JSON.stringify(c) }),
  editarFlashcard: (id: string, c: { frente: string; verso: string }) =>
    jsonFetch<{ card: Flashcard; anki: EstadoAnki }>(`/api/flashcards/${id}`, { method: 'PATCH', body: JSON.stringify(c) }),
  apagarFlashcard: (id: string) => jsonFetch<{ anki: EstadoAnki }>(`/api/flashcards/${id}`, { method: 'DELETE' }),
  ankiStatus: () => jsonFetch<{ estado: EstadoAnki; pendentes: number }>('/api/anki/status'),
  driveCriarCurso,
  driveStatus: () => jsonFetch<DriveStatus>('/api/drive/status'),
  driveDesconectar: () => jsonFetch<void>('/api/drive/auth', { method: 'DELETE' }),
  driveSalvarCredenciais: (c: Partial<Record<CredencialDrive, string>>) =>
    jsonFetch<void>('/api/drive/credenciais', { method: 'PUT', body: JSON.stringify(c) }),
  telegramCriarCurso: (link: string) => telegramPost('/api/telegram/courses', link),
  telegramEntrarConvite: (link: string) => telegramPost('/api/telegram/convite', link),
  telegramStatus: () => jsonFetch<TelegramStatus>('/api/telegram/status'),
  telegramIniciarLogin: () => jsonFetch<EstadoLoginTelegram>('/api/telegram/login', { method: 'POST' }),
  telegramEstadoLogin: () => jsonFetch<EstadoLoginTelegram>('/api/telegram/login'),
  telegramSenha: (senha: string) =>
    jsonFetch<EstadoLoginTelegram>('/api/telegram/login/senha', { method: 'POST', body: JSON.stringify({ senha }) }),
  telegramCancelarLogin: () => jsonFetch<void>('/api/telegram/login', { method: 'DELETE' }),
  telegramDesconectar: () => jsonFetch<void>('/api/telegram/auth', { method: 'DELETE' }),
  telegramSalvarCredenciais: (c: { apiId?: string; apiHash?: string }) =>
    jsonFetch<TelegramStatus>('/api/telegram/credenciais', { method: 'PUT', body: JSON.stringify(c) }),
  driveIniciarAuth: () => jsonFetch<{ url: string }>('/api/drive/auth/iniciar', { method: 'POST' }),
  importLibrary: (data: unknown) =>
    jsonFetch<ImportPlan>('/api/library/import', { method: 'POST', body: JSON.stringify(data) }),
};
