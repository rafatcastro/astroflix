import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import { pastaDoCurso, sanear } from '../armazenamento';
import { inserirCursoDerivado } from '../scan/scan-course';
import { reconcileCourse } from '../scan/reconcile';
import { baixarVideo, listar, temYtDlp, type VideoAchado } from './ytdlp';
import { cabecalhoDeLogin, candidatosDaPagina, lerPagina, loginMascarado, mandaLogin, type Candidato } from './pagina';
import { obterNavegador, type Navegador } from './navegador';
import { createLimiter } from '../media/ffmpeg';

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

// O vídeo que o player pediu pela rede: a lista do HLS/DASH (a primeira pedida é a
// principal, as de cada qualidade vêm depois) ou, sem ela, o arquivo.
const principal = (midias: string[]) => midias.find((m) => /\.(m3u8|mpd)(\?|$)/i.test(m)) ?? midias[0] ?? null;
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

  void descobrir(estado, ac.signal, token ?? null, comLogin, registrar, salvar, config.dataDir)
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
  dataDir: string,
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
  let falhaDeAcesso = false;
  let foiProLogin = false;
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
  // ordem da página (é a ordem das aulas numa lista de curso). Com um Chrome
  // instalado, a página abre nele e o app espera o JavaScript montar a lista.
  const usado = await obterNavegador(dataDir).catch((e) => {
    registrar(`navegador não abriu: ${e instanceof Error ? e.message : e}`);
    return null;
  });
  if (usado) registrar(`navegador: ${usado.exe} (perfil do Astroflix, com o login feito em "Entrar no site")`);
  else registrar('navegador: nenhum Chrome, Edge ou Brave instalado; lendo só o HTML cru (sem JavaScript)');
  try {
    await lerELinks(usado?.nav ?? null);
  } finally {
    usado?.soltar();
  }

  async function lerELinks(nav: Navegador | null): Promise<void> {
    registrar('abrindo a página…');
    const resp = await lerPagina(link, signal, login);
    registrar(
      `página (HTML cru): ${resp.erro ?? `HTTP ${resp.status}`}, ${resp.tipo ?? 'sem tipo'}, ${resp.bytes} bytes${resp.url !== link ? `, redirecionou para ${resp.url}` : ''}`,
    );
    if (resp.corpo) salvar(resp.html ? 'pagina.html' : 'resposta.txt', resp.corpo);
    if (resp.status === 401 || resp.status === 403) registrar('a página recusou o acesso: o login (token) faltou, venceu ou não é desse site');
    else if (resp.html && resp.url !== link && /login|signin|entrar|auth/i.test(resp.url)) registrar('redirecionou para uma página de login: o token não foi aceito');
    falhaDeAcesso = resp.status === 401 || resp.status === 403;

    let pagina = resp.html ? { html: resp.html, url: resp.url } : null;
    let midiasDaPagina: string[] = [];
    if (nav) {
      registrar('abrindo no navegador e esperando a página carregar (até 30 s)…');
      const r = await nav.renderizar(link, { login, loginPara: (u) => mandaLogin(u, link, embutidos) || !!loginPara(u), signal }).catch((e) => {
        registrar(`navegador: falhou: ${e instanceof Error ? e.message : e}`);
        return null;
      });
      if (r) {
        if (r.url !== link && /\/(login|signin|entrar|auth)\b/i.test(new URL(r.url).pathname)) {
          registrar('o site mandou para a página de login: use "Entrar no site" na janela de importar e tente de novo');
          foiProLogin = true;
        }
        registrar(
          `página (navegador): HTTP ${r.status ?? '?'}, ${r.html.length} bytes em ${(r.esperou / 1000).toFixed(1)} s${r.url !== link ? `, terminou em ${r.url}` : ''}, ${r.midias.length} vídeo(s) pedido(s) pela rede`,
        );
        for (const m of r.midias) registrar(`  rede: ${m}`);
        salvar('pagina-renderizada.html', r.html);
        if (r.html) {
          pagina = { html: r.html, url: r.url };
          midiasDaPagina = r.midias;
          falhaDeAcesso = r.status === 401 || r.status === 403;
        }
        // A página colada já toca um vídeo (é uma aula): ele entra direto, sem
        // passar pelo yt-dlp, que gastaria o tempo de um endereço assinado.
        const proprio = principal(r.midias);
        if (proprio && !vistos.has(proprio)) {
          const v = { url: proprio, titulo: tituloDaPagina(r.html) ?? estado.titulo ?? proprio, duracaoSec: null, pagina: link };
          daPagina.push(v);
          if (login && mandaLogin(proprio, link, embutidos)) comLogin.add(proprio);
          acrescentar(v);
          registrar(`vídeo da própria página: ${proprio}`);
        }
      }
    }
    // Os links da tela de login ("esqueci a senha") não são aulas.
    if (!pagina || foiProLogin) return;

    // O <title> da página nomeia melhor o curso que o do vídeo embutido.
    estado.titulo = tituloDaPagina(pagina.html) ?? estado.titulo;
    // O que a rede já deu (a lista do HLS e as de cada qualidade) não é aberto de novo.
    const ja = new Set(midiasDaPagina);
    const candidatos = candidatosDaPagina(pagina.html, pagina.url).filter((c) => !ja.has(c.url));
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

    // Uma aula do mesmo site em que o yt-dlp não achou vídeo: o player deve vir
    // por JavaScript. Abre no navegador e tenta o que ele carregou (2 por vez).
    const limiteNav = createLimiter(2);
    let abertasNoNav = 0;
    const MAX_NO_NAV = 80;
    const peloNavegador = async (c: Candidato, rotulo: string): Promise<VideoAchado | null> => {
      if (!nav || c.embutido || abertasNoNav >= MAX_NO_NAV) return null;
      if (!mandaLogin(c.url, link, new Set())) return null;
      abertasNoNav++;
      const r = await limiteNav(() => nav.renderizar(c.url, { login, loginPara: (u) => mandaLogin(u, link, embutidos) || !!loginPara(u), referer: pagina!.url, signal })).catch(
        (e) => {
          registrar(`${rotulo}: navegador falhou: ${e instanceof Error ? e.message : e}`);
          return null;
        },
      );
      if (!r) return null;
      registrar(`${rotulo}: no navegador (${(r.esperou / 1000).toFixed(1)} s): ${r.midias.length} vídeo(s) pela rede`);
      for (const m of r.midias) registrar(`${rotulo}:   rede: ${m}`);
      // O player pediu um vídeo: é a aula. Entra direto (ver "vídeo da própria página").
      const daRede = principal(r.midias);
      if (daRede) {
        if (login && mandaLogin(daRede, link, embutidos)) comLogin.add(daRede);
        registrar(`${rotulo}:   vídeo: ${daRede}`);
        return { url: daRede, titulo: c.texto || tituloDaPagina(r.html) || daRede, duracaoSec: null, pagina: c.url };
      }
      const dentro = candidatosDaPagina(r.html, r.url).filter((x) => x.embutido);
      registrar(`${rotulo}:   ${dentro.length} player(s) na página para tentar`);
      for (const d of dentro.slice(0, 6)) {
        try {
          embutidos.add(new URL(d.url).hostname);
        } catch {
          /* sem host */
        }
        const loginDele = loginPara(d.url);
        const v = await listar(d.url, { referer: r.url, timeoutMs: 45_000, signal, login: loginDele, aoErro: (m) => registrar(`${rotulo}:   ${d.url}: ${m}`) }).catch(() => null);
        const video = v?.tipo === 'video' ? v.video : v?.tipo === 'playlist' && v.itens.length === 1 ? v.itens[0] : null;
        if (video) {
          if (loginDele) comLogin.add(video.url);
          registrar(`${rotulo}:   vídeo: ${video.url}`);
          return { ...video, titulo: c.texto || video.titulo, pagina: c.url };
        }
      }
      return null;
    };

    const achados: Array<VideoAchado[] | undefined> = new Array(candidatos.length);
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < candidatos.length && !signal.aborted) {
        const i = proximo++;
        const c = candidatos[i];
        const loginDele = loginPara(c.url);
        const rotulo = `[${i + 1}/${candidatos.length}] ${c.embutido ? 'player ' : ''}${c.url}${loginDele ? ' (com login)' : ''}`;
        const r = await listar(c.url, {
          referer: pagina!.url,
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
        } else {
          const v = await peloNavegador(c, rotulo);
          if (v) achados[i] = [v];
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
    estado.erro = foiProLogin ? 'precisa-entrar' : falhaDeAcesso ? 'sem-acesso' : 'sem-videos';
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
  /** A página da aula, para pedir o endereço do vídeo de novo se ele vencer (ver VideoAchado). */
  pagina?: string | null;
  /** Mandado pela extensão: os cabeçalhos com que o navegador da pessoa pediu o vídeo. */
  cabecalhos?: Array<{ nome: string; valor: string }>;
  /** A sub-playlist (a subpasta, que vira módulo do curso); sem ela, na raiz. */
  modulo?: string | null;
  erro: string | null;
}
interface Manifesto {
  link: string;
  referer: string | null;
  /** O token de login colado; fica só nesta máquina, dentro da pasta de dados. */
  token?: string | null;
  /** As sub-playlists, na ordem de criação: nomes das subpastas ("01 - Funções"). */
  modulos?: string[];
  /** "Baixar para downloads" pedido: cada vídeo que chegar também vai para a pasta de downloads. */
  exportar?: boolean;
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
    itens: Array<{ url: string; titulo: string; pagina?: string | null }>;
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
      pagina: i.pagina ?? null,
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

  // A lista é relida a cada vídeo: a extensão acrescenta aulas no meio do download
  // (só acrescenta; as posições não mudam), e cada item é gravado sozinho, sem
  // sobrescrever o que entrou enquanto este baixava.
  const tentados = new Set<number>();
  for (;;) {
    const atual = lerManifesto(pasta);
    if (!atual || !cursoExiste(db, courseId)) return;
    estado.total = atual.itens.length;
    const i = atual.itens.findIndex((it, k) => !tentados.has(k) && !(it.arquivo && fs.existsSync(path.join(pasta, it.arquivo))));
    if (i < 0) break;
    tentados.add(i);
    const item = atual.itens[i];
    // O número na frente do nome mantém a ordem da lista (o scan ordena pelo nome),
    // contado dentro da sub-playlist: a primeira aula de cada módulo é a 01.
    const doModulo = atual.itens.filter((it) => (it.modulo ?? null) === (item.modulo ?? null));
    const largura = Math.max(2, String(doModulo.length).length);
    const nome = sanear(`${String(doModulo.indexOf(item) + 1).padStart(largura, '0')} - ${item.titulo}`, 140);
    const destinoDir = item.modulo ? path.join(pasta, item.modulo) : pasta;
    estado.atual = { titulo: item.titulo, pct: null };
    const ac = new AbortController();
    atualAc = { courseId, ac };
    const baixar = (url: string, referer: string | undefined) =>
      baixarVideo(url, path.join(pasta, TEMP), nome, {
        referer,
        login: item.login ? login : null,
        cabecalhos: item.cabecalhos,
        signal: ac.signal,
        aoProgresso: (pct) => {
          if (estado.atual) estado.atual.pct = pct;
        },
      });
    const mudou: Partial<ItemManifesto> = {};
    try {
      let baixado: string;
      try {
        baixado = await baixar(item.url, item.pagina ?? m.referer ?? undefined);
      } catch (e) {
        // O endereço do vídeo pode ter vencido: reabre a aula e pede um novo. Só se a
        // página for só desta aula: num site em JavaScript (a lista inteira num
        // endereço), reabrir daria o vídeo de outra aula com o título desta.
        const paginaSo = !!item.pagina && atual.itens.filter((it) => it.pagina === item.pagina).length === 1;
        if (ac.signal.aborted || !paginaSo) throw e;
        registrar(`falhou (${e instanceof Error ? e.message : e}); reabrindo ${item.pagina} para pegar o endereço de novo`);
        const novo = await enderecoNovo(config.dataDir, item.pagina!, m.link, login, ac.signal);
        if (!novo) throw e;
        registrar(`endereço novo: ${novo}`);
        mudou.url = novo;
        baixado = await baixar(novo, item.pagina!);
      }
      fs.mkdirSync(destinoDir, { recursive: true });
      const final = path.join(destinoDir, `${nome}${path.extname(baixado)}`);
      fs.renameSync(baixado, final);
      // Relativo à pasta do curso: "01 - Funções/03 - Aula.mp4".
      mudou.arquivo = path.relative(pasta, final).split(path.sep).join('/');
      mudou.erro = null;
      estado.feitos++;
      registrar(`ok: ${mudou.arquivo} (${fs.statSync(final).size} bytes) ← ${mudou.url ?? item.url}${item.login ? ' (com login)' : ''}`);
      if (lerManifesto(pasta)?.exportar) {
        await levarParaDownloads(pasta, mudou.arquivo, pastaDoCurso(db, config, courseId)).catch((e) =>
          registrar(`não foi para a pasta de downloads: ${mudou.arquivo}: ${e instanceof Error ? e.message : e}`),
        );
      }
    } catch (e) {
      if (ac.signal.aborted) return registrar(`parado: ${item.url}`);
      mudou.erro = e instanceof Error ? e.message : 'falhou';
      estado.falhas++;
      const detalhe = (e as { detalhe?: string }).detalhe;
      registrar(`FALHOU: ${item.titulo} ← ${item.url}${item.login ? ' (com login)' : ''}: ${mudou.erro}${detalhe ? `\n${detalhe.trim()}\n---` : ''}`);
    } finally {
      atualAc = null;
    }
    const agora = lerManifesto(pasta);
    if (agora?.itens[i]) {
      Object.assign(agora.itens[i], mudou);
      gravarManifesto(pasta, agora);
    }
    // A aula aparece no curso assim que chega.
    if (cursoExiste(db, courseId)) reconcileCourse(db, config, courseId);
  }
  fs.rmSync(path.join(pasta, TEMP), { recursive: true, force: true });
  if (estado.falhas) estado.erro = `${estado.falhas} vídeo(s) não baixaram`;
  registrar(`fim: ${estado.feitos} de ${estado.total} baixados, ${estado.falhas} falha(s)`);
}

/** Abre a página da aula no navegador e devolve o primeiro vídeo que o player pedir. */
async function enderecoNovo(
  dataDir: string,
  pagina: string,
  link: string,
  login: ReturnType<typeof cabecalhoDeLogin>,
  signal: AbortSignal,
): Promise<string | null> {
  const usado = await obterNavegador(dataDir).catch(() => null);
  if (!usado) return null;
  try {
    const r = await usado.nav.renderizar(pagina, {
      login,
      loginPara: (u) => mandaLogin(u, link, new Set([new URL(u).hostname])),
      signal,
      pararNoVideo: true,
    });
    const doHtml = candidatosDaPagina(r.html, r.url).filter((c) => c.embutido).map((c) => c.url);
    return r.midias[0] ?? doHtml[0] ?? null;
  } catch {
    return null;
  } finally {
    usado.soltar();
  }
}

/** O log dos downloads do curso, se for um curso de link e já tiver um. */
export function logDoCurso(db: Db, courseId: string): string | null {
  const curso = db.prepare('SELECT root_path FROM courses WHERE id=?').get(courseId) as { root_path: string } | undefined;
  const arquivo = curso ? path.join(curso.root_path, LOG_DO_CURSO) : null;
  return arquivo && fs.existsSync(arquivo) ? arquivo : null;
}

// ---------- Playlists (a extensão do navegador) ----------

// Uma "playlist" é um curso de link: a pasta em DATA_DIR/links com o manifesto.
// A extensão escolhe uma e manda a aula aberta no navegador da pessoa (que já está
// logada no site); o vídeo entra no fim e a fila baixa.

export interface Playlist {
  id: string;
  titulo: string;
  categoriaId: string | null;
  itens: number;
  baixados: number;
  /** As sub-playlists (módulos), na ordem de criação. */
  modulos: Array<{ pasta: string; nome: string; itens: number }>;
}

// "03 - Funções" → "Funções": o número só ordena as pastas.
export const nomeDoModulo = (pasta: string) => pasta.replace(/^\d+\s*-\s*/, '');

/** O manifesto de um curso de link, ou null. */
export function manifestoDoCurso(db: Db, courseId: string): { pasta: string; m: Manifesto } | null {
  const curso = db.prepare('SELECT root_path FROM courses WHERE id=?').get(courseId) as { root_path: string } | undefined;
  const m = curso ? lerManifesto(curso.root_path) : null;
  return curso && m ? { pasta: curso.root_path, m } : null;
}

/**
 * Uma playlist dentro da outra: uma subpasta, que o scan mostra como módulo. O
 * número na frente mantém a ordem de criação (o scan ordena os módulos pelo nome).
 */
export function criarSubPlaylist(db: Db, courseId: string, titulo: string): { pasta: string; nome: string } | null {
  const achado = manifestoDoCurso(db, courseId);
  if (!achado) return null;
  const { pasta, m } = achado;
  const modulos = m.modulos ?? [];
  const nome = sanear(titulo.trim() || 'Módulo', 100);
  const existente = modulos.find((x) => nomeDoModulo(x).toLowerCase() === nome.toLowerCase());
  if (existente) return { pasta: existente, nome: nomeDoModulo(existente) };
  const sub = `${String(modulos.length + 1).padStart(2, '0')} - ${nome}`;
  fs.mkdirSync(path.join(pasta, sub), { recursive: true });
  m.modulos = [...modulos, sub];
  gravarManifesto(pasta, m);
  return { pasta: sub, nome };
}

export function listarPlaylists(db: Db, config: AppConfig): Playlist[] {
  const raiz = pastaDosLinks(config);
  const cursos = db
    .prepare('SELECT id, title, root_path, collection_id FROM courses WHERE root_path LIKE ? AND archived=0 ORDER BY updated_at DESC')
    .all(`${raiz}${path.sep}%`) as Array<{ id: string; title: string; root_path: string; collection_id: string | null }>;
  return cursos
    .map((c) => {
      const m = lerManifesto(c.root_path);
      return m
        ? {
            id: c.id,
            titulo: c.title,
            categoriaId: c.collection_id,
            itens: m.itens.length,
            baixados: m.itens.filter((i) => i.arquivo).length,
            modulos: (m.modulos ?? []).map((pasta) => ({ pasta, nome: nomeDoModulo(pasta), itens: m.itens.filter((i) => i.modulo === pasta).length })),
          }
        : null;
    })
    .filter((p): p is Playlist => !!p);
}

export function criarPlaylist(db: Db, config: AppConfig, titulo: string, categoriaId: string | null): string {
  return criarCursoDeLinks(db, config, { titulo, link: '', categoriaId, token: null, comLogin: new Set(), itens: [] });
}

export function adicionarAPlaylist(
  db: Db,
  config: AppConfig,
  courseId: string,
  item: { url: string; titulo: string; pagina: string | null; cabecalhos: Array<{ nome: string; valor: string }>; modulo?: string | null },
): { posicao: number; repetido: boolean } | null {
  const curso = db.prepare('SELECT root_path FROM courses WHERE id=?').get(courseId) as { root_path: string } | undefined;
  const m = curso ? lerManifesto(curso.root_path) : null;
  if (!curso || !m) return null;
  // A mesma aula duas vezes (clicou de novo): não duplica, só atualiza o
  // endereço, que pode ter vencido.
  // Num site em JavaScript todas as aulas têm o mesmo endereço de página: a mesma
  // aula é o mesmo vídeo, ou a mesma página com o mesmo título.
  const ja = m.itens.findIndex(
    (i) => i.url === item.url || (!!item.pagina && i.pagina === item.pagina && i.titulo.trim() === item.titulo.trim() && (i.modulo ?? null) === (item.modulo ?? null)),
  );
  if (ja >= 0) {
    const i = m.itens[ja];
    if (!i.arquivo) Object.assign(i, { url: item.url, cabecalhos: item.cabecalhos, erro: null });
    gravarManifesto(curso.root_path, m);
    if (!i.arquivo) enfileirar(db, config, courseId);
    return { posicao: ja + 1, repetido: true };
  }
  // Sub-playlist que não existe (apagada no meio): vai para a raiz.
  const modulo = item.modulo && (m.modulos ?? []).includes(item.modulo) ? item.modulo : null;
  m.itens.push({ url: item.url, titulo: item.titulo.trim() || item.url, arquivo: null, erro: null, pagina: item.pagina, cabecalhos: item.cabecalhos, modulo });
  gravarManifesto(curso.root_path, m);
  db.prepare('UPDATE courses SET updated_at=? WHERE id=?').run(new Date().toISOString(), courseId);
  enfileirar(db, config, courseId);
  return { posicao: m.itens.filter((i) => (i.modulo ?? null) === modulo).length, repetido: false };
}

// ---------- "Baixar para downloads" ----------
// A playlist mora em DATA_DIR/links (a pasta do app, escondida). A pessoa quer os
// vídeos onde ficam os outros downloads (Configurações → Armazenamento), com o
// nome do curso, para levar embora ou abrir em outro player. No mesmo disco vai
// como hard link: o mesmo arquivo em dois lugares, sem ocupar o dobro; em outro
// disco, cópia. A pasta de downloads fica sendo da pessoa: o app não a apaga
// (nem o "Limpar tudo", que só apaga o que registrou como baixado do Drive e do Telegram).

/** Um arquivo da playlist para a pasta de downloads. false = já estava lá (mesmo tamanho). */
async function levarParaDownloads(origemRaiz: string, rel: string, destinoRaiz: string): Promise<boolean> {
  const de = path.join(origemRaiz, ...rel.split('/'));
  const para = path.join(destinoRaiz, ...rel.split('/'));
  const tam = fs.statSync(de).size;
  try {
    if (fs.statSync(para).size === tam) return false;
  } catch {
    /* não existe: vai */
  }
  fs.mkdirSync(path.dirname(para), { recursive: true });
  // Grava ao lado e troca no fim: uma cópia entre discos que parar no meio não
  // deixa um vídeo cortado com o nome certo (que a próxima vez trocaria, pelo tamanho).
  const temp = `${para}.astroflix-tmp`;
  fs.rmSync(temp, { force: true });
  try {
    fs.linkSync(de, temp);
  } catch {
    await fs.promises.copyFile(de, temp);
  }
  fs.renameSync(temp, para);
  return true;
}

/** Os arquivos da playlist (vídeos, nas subpastas dos módulos), sem os do app (dotfiles). */
function arquivosDaPlaylist(raiz: string, sub = ''): string[] {
  const saida: string[] = [];
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(path.join(raiz, sub), { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    if (e.name.startsWith('.')) continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) saida.push(...arquivosDaPlaylist(raiz, rel));
    else if (e.isFile()) saida.push(rel);
  }
  return saida;
}

export interface ResultadoExportacao {
  pasta: string;
  levados: number;
  jaEstavam: number;
  /** Vídeos ainda baixando: vão sozinhos quando chegarem. */
  faltam: number;
  falhas: number;
}

/** "Baixar para downloads": o que já chegou vai agora; o resto, ao chegar. */
export async function exportarPlaylist(db: Db, config: AppConfig, courseId: string): Promise<ResultadoExportacao | null> {
  const achado = manifestoDoCurso(db, courseId);
  if (!achado) return null;
  const { pasta, m } = achado;
  if (!m.exportar) {
    m.exportar = true;
    gravarManifesto(pasta, m);
  }
  const destino = pastaDoCurso(db, config, courseId);
  fs.mkdirSync(destino, { recursive: true });
  const r: ResultadoExportacao = { pasta: destino, levados: 0, jaEstavam: 0, faltam: m.itens.filter((i) => !i.arquivo && !i.erro).length, falhas: 0 };
  for (const rel of arquivosDaPlaylist(pasta)) {
    try {
      if (await levarParaDownloads(pasta, rel, destino)) r.levados++;
      else r.jaEstavam++;
    } catch {
      r.falhas++;
    }
  }
  return r;
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
