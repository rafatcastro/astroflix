import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { sanear } from '../armazenamento';
import { inserirCursoDerivado } from '../scan/scan-course';
import { reconcileCourse } from '../scan/reconcile';
import { baixarVideo, listar, temYtDlp, type VideoAchado } from './ytdlp';
import { cabecalhoDeLogin, candidatosDaPagina, lerPagina, loginMascarado, mandaLogin } from './pagina';

// Importar por link: a pessoa cola o link de uma página (uma playlist do YouTube,
// a página de um curso), o app acha os vídeos, ela revisa a lista e confirma.
// Cada vídeo é baixado pelo yt-dlp para DATA_DIR/links/<curso>, e essa pasta é um
// curso local como outro qualquer: o player, as capas, a duração e o progresso
// são os mesmos, sem uma origem nova para a nuvem e para o stream conhecerem.
// O preço é o vídeo só tocar depois de baixado; um curso assinado pode sair do ar,
// e o arquivo no disco fica.

// ---------- Descoberta (a prévia, antes de criar o curso) ----------

export interface Descoberta {
  fase: 'lendo' | 'pronto' | 'erro';
  link: string;
  titulo: string | null;
  /** Links da página já abertos e quantos há para abrir (0/0 numa playlist). */
  verificados: number;
  total: number;
  itens: VideoAchado[];
  erro: string | null;
  /** O que aconteceu, passo a passo: o status da página, o que o yt-dlp disse de cada link. */
  log: string[];
}

// O yt-dlp não conhece o site e só achou um vídeo solto na página: "Generic", ou
// "HTML5MediaEmbed" quando é um <video> direto. O título dele aí é o da página com
// "(1)", e a página pode ter a lista das outras aulas.
const ehGenerico = (extrator: string) => /^(generic|html5mediaembed)$/i.test(extrator);

// Por vídeo achado: se o download leva o login (ver mandaLogin). Fica fora do
// estado que a janela lê, que não precisa saber disso.
const descobertas = new Map<
  string,
  { estado: Descoberta; ac: AbortController; criadaEm: number; comLogin: Set<string>; pastaLog: string }
>();
const SIMULTANEOS = 4;
const MAX_LOG = 3000;

// Cada leitura deixa uma pasta em DATA_DIR/logs/links: o log e o HTML que o
// servidor recebeu (o "print" do que o app viu; uma lista de aulas montada por
// JavaScript aparece ali vazia). Ficam as 30 mais novas.
export const pastaDosLogs = (config: AppConfig) => path.join(config.dataDir, 'logs', 'links');
const MANTER_LOGS = 30;

function limparLogsAntigos(raiz: string): void {
  try {
    const pastas = fs.readdirSync(raiz).sort();
    for (const p of pastas.slice(0, Math.max(0, pastas.length - MANTER_LOGS))) fs.rmSync(path.join(raiz, p), { recursive: true, force: true });
  } catch {
    /* sem logs ainda */
  }
}

export function iniciarDescoberta(config: AppConfig, link: string, token?: string | null): string {
  // As antigas (a pessoa fechou a janela) saem depois de uma hora.
  for (const [id, d] of descobertas) if (Date.now() - d.criadaEm > 3_600_000) descobertas.delete(id);
  const id = randomUUID();
  const estado: Descoberta = { fase: 'lendo', link, titulo: null, verificados: 0, total: 0, itens: [], erro: null, log: [] };
  const ac = new AbortController();
  const comLogin = new Set<string>();
  const raiz = pastaDosLogs(config);
  let host = 'link';
  try {
    host = new URL(link).hostname;
  } catch {
    /* fica "link" */
  }
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const pastaLog = path.join(raiz, sanear(`${carimbo} ${host}`, 100));
  descobertas.set(id, { estado, ac, criadaEm: Date.now(), comLogin, pastaLog });

  const registrar = (msg: string) => {
    const linha = `${new Date().toISOString().slice(11, 19)} ${msg}`;
    if (estado.log.length < MAX_LOG) estado.log.push(linha);
    try {
      fs.mkdirSync(pastaLog, { recursive: true });
      fs.appendFileSync(path.join(pastaLog, 'leitura.log'), `${linha}\n`);
    } catch {
      /* o log nunca derruba a leitura */
    }
  };
  const salvar = (nome: string, conteudo: string) => {
    try {
      fs.mkdirSync(pastaLog, { recursive: true });
      fs.writeFileSync(path.join(pastaLog, nome), conteudo);
    } catch {
      /* idem */
    }
  };
  limparLogsAntigos(raiz);

  void descobrir(estado, ac.signal, token ?? null, comLogin, registrar, salvar)
    .catch((e) => {
      estado.fase = 'erro';
      estado.erro = e instanceof Error ? e.message : 'falhou';
      registrar(`ERRO: ${estado.erro}`);
    })
    .finally(() => registrar(`fim: ${estado.fase}${estado.erro ? ` (${estado.erro})` : ''}, ${estado.itens.length} vídeo(s)`));
  return id;
}

export const estadoDaDescoberta = (id: string): Descoberta | null => descobertas.get(id)?.estado ?? null;
export const pastaDoLogDaDescoberta = (id: string): string | null => descobertas.get(id)?.pastaLog ?? null;

/** Os vídeos achados que levam o login no download (o pedido de importar vem com o id da descoberta). */
export const comLoginDaDescoberta = (id: string): Set<string> => descobertas.get(id)?.comLogin ?? new Set();

// Só para: o que já achou (e quem leva o login) continua valendo para o "Importar".
export function cancelarDescoberta(id: string): void {
  descobertas.get(id)?.ac.abort();
}

async function descobrir(
  estado: Descoberta,
  signal: AbortSignal,
  token: string | null,
  comLogin: Set<string>,
  registrar: (msg: string) => void,
  salvar: (nome: string, conteudo: string) => void,
): Promise<void> {
  const link = estado.link;
  registrar(`link: ${link}`);
  if (!temYtDlp()) throw new Error('sem-ytdlp');
  // Curso assinado: o token que a pessoa colou. Vai só para o site do link e para
  // os players embutidos na página dele, nunca para um YouTube linkado no rodapé.
  const login = cabecalhoDeLogin(token);
  registrar(login ? `login: ${loginMascarado(login)}` : 'login: nenhum');
  const embutidos = new Set<string>();
  const loginPara = (url: string) => (login && mandaLogin(url, link, embutidos) ? login : null);
  const vistos = new Set<string>();
  const acrescentar = (v: VideoAchado) => {
    if (vistos.has(v.url)) return;
    vistos.add(v.url);
    estado.itens.push(v);
  };

  // Primeiro o yt-dlp na própria página. Um site que ele conhece (uma playlist
  // do YouTube, um vídeo do Vimeo) já vem inteiro daqui, sem abrir link nenhum.
  registrar('yt-dlp no link…');
  const direto = await listar(link, { signal, login, aoErro: (m) => registrar(`yt-dlp no link: falhou: ${m}`) });
  if (signal.aborted) return registrar('parado pela pessoa');
  const daPagina: VideoAchado[] = direto?.tipo === 'playlist' ? direto.itens : direto ? [direto.video] : [];
  if (direto) registrar(`yt-dlp no link: ${direto.extrator}, ${direto.tipo}, ${daPagina.length} vídeo(s)`);
  if (login) for (const v of daPagina) comLogin.add(v.url);
  daPagina.forEach(acrescentar);
  estado.titulo = direto?.tipo === 'playlist' ? direto.titulo : (direto?.video.titulo ?? null);
  if (direto && !ehGenerico(direto.extrator) && daPagina.length) {
    estado.fase = 'pronto';
    return;
  }

  // Uma página qualquer: abre cada link dela e fica com os que têm vídeo, na
  // ordem da página (é a ordem das aulas numa lista de curso).
  registrar('abrindo a página…');
  const resp = await lerPagina(link, signal, login);
  registrar(
    `página: ${resp.erro ?? `HTTP ${resp.status}`}, ${resp.tipo ?? 'sem tipo'}, ${resp.bytes} bytes${resp.url !== link ? `, redirecionou para ${resp.url}` : ''}`,
  );
  if (resp.corpo) salvar(resp.html ? 'pagina.html' : 'resposta.txt', resp.corpo);
  if (resp.status === 401 || resp.status === 403) registrar('a página recusou o acesso: o login (token) faltou, venceu ou não é desse site');
  else if (resp.html && resp.url !== link && /login|signin|entrar|auth/i.test(resp.url)) registrar('redirecionou para uma página de login: o token não foi aceito');
  const pagina = resp.html ? { html: resp.html, url: resp.url } : null;
  if (pagina) {
    // O <title> da página nomeia melhor o curso que o do vídeo embutido.
    estado.titulo = tituloDaPagina(pagina.html) ?? estado.titulo;
    const candidatos = candidatosDaPagina(pagina.html, pagina.url);
    estado.total = candidatos.length;
    for (const c of candidatos) {
      if (!c.embutido) continue;
      try {
        embutidos.add(new URL(c.url).hostname);
      } catch {
        /* sem host */
      }
    }
    const nScripts = (pagina.html.match(/<script\b/gi) ?? []).length;
    const nLinks = (pagina.html.match(/<a\b/gi) ?? []).length;
    registrar(`página: título "${estado.titulo ?? ''}", ${nLinks} <a>, ${nScripts} <script>, ${candidatos.length} link(s) para abrir (${embutidos.size} player(s) embutido(s))`);
    if (!candidatos.length && nScripts > nLinks)
      registrar('a página quase não tem links e tem muito script: a lista de aulas deve ser montada por JavaScript depois de abrir');
    const achados: Array<VideoAchado[] | undefined> = new Array(candidatos.length);
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < candidatos.length && !signal.aborted) {
        const i = proximo++;
        const c = candidatos[i];
        const loginDele = loginPara(c.url);
        const rotulo = `[${i + 1}/${candidatos.length}] ${c.embutido ? 'player ' : ''}${c.url}${loginDele ? ' (com login)' : ''}`;
        const r = await listar(c.url, {
          referer: pagina.url,
          soUm: !c.embutido,
          timeoutMs: 45_000,
          signal,
          login: loginDele,
          aoErro: (m) => registrar(`${rotulo}: sem vídeo: ${m}`),
        }).catch(() => null);
        if (r?.tipo === 'video') {
          if (loginDele) comLogin.add(r.video.url);
          // O título do yt-dlp num site genérico costuma ser o nome do arquivo ou o
          // do site inteiro; o texto do link é o nome da aula na lista.
          const generico = ehGenerico(r.extrator);
          achados[i] = [{ ...r.video, titulo: generico && c.texto ? c.texto : r.video.titulo }];
          registrar(`${rotulo}: vídeo (${r.extrator}) "${achados[i]![0].titulo}"`);
        } else if (r?.tipo === 'playlist') {
          // Uma playlist ou um canal linkado (o rodapé com o canal do site no YouTube)
          // não é aula desta página: fica de fora.
          registrar(`${rotulo}: playlist com ${r.itens.length} (ignorada)`);
        }
        estado.verificados++;
        // Mostra o que já achou, na ordem da página, sem esperar o resto.
        estado.itens = [];
        vistos.clear();
        daPagina.forEach(acrescentar);
        for (const a of achados) a?.forEach(acrescentar);
      }
    };
    await Promise.all(Array.from({ length: SIMULTANEOS }, trabalhador));
  }
  if (signal.aborted) return registrar('parado pela pessoa');
  if (!estado.itens.length) {
    estado.erro = pagina ? 'sem-videos' : resp.status === 401 || resp.status === 403 ? 'sem-acesso' : 'nao-abriu';
    estado.fase = 'erro';
    return;
  }
  estado.fase = 'pronto';
}

function tituloDaPagina(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = m?.[1].replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 150) : null;
}

// ---------- Importação (os downloads, curso a curso) ----------

// O que foi pedido fica num arquivo dentro da pasta do curso (oculto, o scan pula
// dotfiles): fechar o app no meio não perde a lista, e ao abrir ele continua.
const MANIFESTO = '.astroflix-link.json';
const TEMP = '.baixando';
// O que cada download respondeu, para entender por que um vídeo não veio.
export const LOG_DO_CURSO = '.astroflix-link.log';

interface ItemManifesto {
  url: string;
  titulo: string;
  /** O nome do arquivo na pasta, quando baixado. */
  arquivo: string | null;
  /** O download leva o login do manifesto (o vídeo é do site do link ou do player dele). */
  login?: boolean;
  erro: string | null;
}
interface Manifesto {
  link: string;
  referer: string | null;
  /** O token de login colado; fica só nesta máquina, dentro da pasta de dados. */
  token?: string | null;
  itens: ItemManifesto[];
}

export interface EstadoImportacao {
  carregando: boolean;
  erro: string | null;
  feitos: number;
  total: number;
  falhas: number;
  atual: { titulo: string; pct: number | null } | null;
}

const estados = new Map<string, EstadoImportacao>();
const fila: string[] = [];
let rodando = false;
let atualAc: { courseId: string; ac: AbortController } | null = null;

export const pastaDosLinks = (config: AppConfig) => path.join(config.dataDir, 'links');

export function importacaoLink(courseId: string): EstadoImportacao | null {
  return estados.get(courseId) ?? null;
}

function lerManifesto(pasta: string): Manifesto | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta, MANIFESTO), 'utf8')) as Manifesto;
  } catch {
    return null;
  }
}
function gravarManifesto(pasta: string, m: Manifesto): void {
  const destino = path.join(pasta, MANIFESTO);
  fs.writeFileSync(`${destino}.tmp`, JSON.stringify(m, null, 2));
  fs.renameSync(`${destino}.tmp`, destino);
}

export function criarCursoDeLinks(
  db: Db,
  config: AppConfig,
  pedido: {
    titulo: string;
    link: string;
    categoriaId: string | null;
    token: string | null;
    comLogin: Set<string>;
    itens: Array<{ url: string; titulo: string }>;
  },
): string {
  const raiz = pastaDosLinks(config);
  const base = sanear(pedido.titulo.trim() || 'Curso', 120);
  let pasta = path.join(raiz, base);
  for (let n = 2; fs.existsSync(pasta); n++) pasta = path.join(raiz, `${base} (${n})`);
  fs.mkdirSync(pasta, { recursive: true });
  gravarManifesto(pasta, {
    link: pedido.link,
    referer: pedido.link,
    token: pedido.token,
    itens: pedido.itens.map((i) => ({
      url: i.url,
      titulo: i.titulo.trim() || i.url,
      arquivo: null,
      erro: null,
      login: !!pedido.token && (pedido.comLogin.has(i.url) || mandaLogin(i.url, pedido.link, new Set())),
    })),
  });
  // O curso existe já vazio: a pessoa vai para ele e vê as aulas entrando.
  const id = inserirCursoDerivado(db, { title: pedido.titulo.trim() || base, rootPath: pasta, source: 'local' }, { structure: 'flat', lessons: [] }, []);
  if (pedido.categoriaId) db.prepare('UPDATE courses SET collection_id=? WHERE id=?').run(pedido.categoriaId, id);
  enfileirar(db, config, id);
  return id;
}

function enfileirar(db: Db, config: AppConfig, courseId: string): void {
  if (!fila.includes(courseId)) fila.push(courseId);
  estados.set(courseId, estados.get(courseId) ?? { carregando: true, erro: null, feitos: 0, total: 0, falhas: 0, atual: null });
  estados.get(courseId)!.carregando = true;
  if (!rodando) void girar(db, config);
}

async function girar(db: Db, config: AppConfig): Promise<void> {
  rodando = true;
  try {
    while (fila.length) {
      const id = fila[0];
      await importarCurso(db, config, id).catch((e) => {
        const s = estados.get(id);
        if (s) s.erro = e instanceof Error ? e.message : 'falhou';
      });
      fila.shift();
      const s = estados.get(id);
      if (s) {
        s.carregando = false;
        s.atual = null;
      }
    }
  } finally {
    rodando = false;
  }
}

const cursoExiste = (db: Db, id: string) => !!db.prepare('SELECT 1 FROM courses WHERE id=?').get(id);

async function importarCurso(db: Db, config: AppConfig, courseId: string): Promise<void> {
  const curso = db.prepare('SELECT root_path FROM courses WHERE id=?').get(courseId) as { root_path: string } | undefined;
  if (!curso) return;
  const pasta = curso.root_path;
  const m = lerManifesto(pasta);
  if (!m) return;
  const estado = estados.get(courseId)!;
  estado.total = m.itens.length;
  estado.feitos = m.itens.filter((i) => i.arquivo).length;
  estado.falhas = 0;
  estado.erro = null;
  const registrar = (msg: string) => {
    try {
      fs.appendFileSync(path.join(pasta, LOG_DO_CURSO), `${new Date().toISOString()} ${msg}\n`);
    } catch {
      /* o log nunca derruba o download */
    }
  };
  if (!temYtDlp()) {
    registrar('yt-dlp não encontrado no PATH');
    throw new Error('sem-ytdlp');
  }
  const login = cabecalhoDeLogin(m.token);
  registrar(`começando: ${m.itens.filter((i) => !i.arquivo).length} de ${m.itens.length} a baixar, login: ${login ? loginMascarado(login) : 'nenhum'}`);

  // O número na frente do nome mantém a ordem da lista revisada (o scan ordena pelo nome).
  const largura = String(m.itens.length).length < 2 ? 2 : String(m.itens.length).length;
  for (let i = 0; i < m.itens.length; i++) {
    const item = m.itens[i];
    if (item.arquivo && fs.existsSync(path.join(pasta, item.arquivo))) continue;
    if (!cursoExiste(db, courseId)) return;
    const nome = sanear(`${String(i + 1).padStart(largura, '0')} - ${item.titulo}`, 140);
    estado.atual = { titulo: item.titulo, pct: null };
    const ac = new AbortController();
    atualAc = { courseId, ac };
    try {
      const baixado = await baixarVideo(item.url, path.join(pasta, TEMP), nome, {
        referer: m.referer ?? undefined,
        login: item.login ? login : null,
        signal: ac.signal,
        aoProgresso: (pct) => {
          if (estado.atual) estado.atual.pct = pct;
        },
      });
      const final = path.join(pasta, `${nome}${path.extname(baixado)}`);
      fs.renameSync(baixado, final);
      item.arquivo = path.basename(final);
      item.erro = null;
      estado.feitos++;
      registrar(`ok: ${item.arquivo} (${fs.statSync(final).size} bytes) ← ${item.url}${item.login ? ' (com login)' : ''}`);
    } catch (e) {
      if (ac.signal.aborted) return registrar(`parado: ${item.url}`);
      item.erro = e instanceof Error ? e.message : 'falhou';
      estado.falhas++;
      const detalhe = (e as { detalhe?: string }).detalhe;
      registrar(`FALHOU: ${item.titulo} ← ${item.url}${item.login ? ' (com login)' : ''}: ${item.erro}${detalhe ? `\n${detalhe.trim()}\n---` : ''}`);
    } finally {
      atualAc = null;
    }
    gravarManifesto(pasta, m);
    // A aula aparece no curso assim que chega.
    if (cursoExiste(db, courseId)) reconcileCourse(db, config, courseId);
  }
  fs.rmSync(path.join(pasta, TEMP), { recursive: true, force: true });
  if (estado.falhas) estado.erro = `${estado.falhas} vídeo(s) não baixaram`;
  registrar(`fim: ${estado.feitos} de ${estado.total} baixados, ${estado.falhas} falha(s)`);
}

/** O log dos downloads do curso, se for um curso de link e já tiver um. */
export function logDoCurso(db: Db, courseId: string): string | null {
  const curso = db.prepare('SELECT root_path FROM courses WHERE id=?').get(courseId) as { root_path: string } | undefined;
  const arquivo = curso ? path.join(curso.root_path, LOG_DO_CURSO) : null;
  return arquivo && fs.existsSync(arquivo) ? arquivo : null;
}

/** Excluir o curso no meio: para o download dele. */
export function pararImportacao(courseId: string): void {
  const i = fila.indexOf(courseId);
  if (i > 0) fila.splice(i, 1);
  if (atualAc?.courseId === courseId) atualAc.ac.abort();
  estados.delete(courseId);
}

/** "Tentar de novo": os que falharam voltam para a fila. */
export function retentarImportacao(db: Db, config: AppConfig, courseId: string): boolean {
  const curso = db.prepare('SELECT root_path FROM courses WHERE id=?').get(courseId) as { root_path: string } | undefined;
  if (!curso || !lerManifesto(curso.root_path)) return false;
  enfileirar(db, config, courseId);
  return true;
}

/** Ao abrir o app: continua os cursos de link que ficaram pela metade. */
export function retomarImportacoes(db: Db, config: AppConfig): void {
  const raiz = pastaDosLinks(config);
  const cursos = db.prepare('SELECT id, root_path FROM courses WHERE root_path LIKE ?').all(`${raiz}${path.sep}%`) as Array<{
    id: string;
    root_path: string;
  }>;
  for (const c of cursos) {
    const m = lerManifesto(c.root_path);
    if (m?.itens.some((i) => !i.arquivo && !i.erro)) enfileirar(db, config, c.id);
  }
}
