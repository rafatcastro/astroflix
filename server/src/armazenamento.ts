import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db';
import type { AppConfig } from './config';

// A pasta onde ficam as aulas e os materiais baixados do Drive e do Telegram,
// com os nomes reais: <raiz>/<curso>/<rel_path>. É a única cópia que o app faz
// (antes havia o cache com o id no nome e, à parte, o "Baixar para Downloads",
// que baixava tudo de novo). A pessoa pode abrir a pasta e levar os arquivos
// embora: o que não está mais lá volta a aparecer como não baixado, e toca pela
// rede. O app nunca apaga nada sozinho; só quando a pessoa pede (Configurações,
// menu do curso) ou exclui o curso.
//
// A raiz é configurável. Trocar começa vazio: o que ficou na antiga não é
// movido, e as aulas de lá deixam de contar como baixadas (voltam se a raiz for
// trocada de volta, porque o banco guarda o caminho absoluto).

const CHAVE_PASTA = 'armazenamento.pasta';

export type TipoBaixado = 'aula' | 'material';

export interface ItemBaixavel {
  tipo: TipoBaixado;
  id: string;
  courseId: string;
  relPath: string;
  remoteId: string;
  tamanho: number;
}

export function pastaDeArmazenamento(db: Db, config: AppConfig): string {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE_PASTA) as { value: string } | undefined;
  return r?.value || config.downloadsDir;
}

/** null volta ao padrão (DATA_DIR/downloads). */
export function definirPastaDeArmazenamento(db: Db, pasta: string | null): void {
  if (pasta === null) db.prepare('DELETE FROM settings WHERE key=?').run(CHAVE_PASTA);
  else
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
      CHAVE_PASTA,
      pasta,
    );
}

const dentro = (arquivo: string, raiz: string) => {
  const rel = path.relative(raiz, arquivo);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * A pasta da pessoa conectada a este curso ("Conectar a uma pasta"), ou null.
 * Nela o app só acrescenta: adota o que já está lá e grava o que a pessoa
 * mandar baixar, mas nunca apaga, renomeia nem converte no lugar um arquivo.
 */
export function pastaConectada(db: Db, courseId: string): string | null {
  const r = db.prepare('SELECT pasta FROM pastas_baixadas WHERE course_id=? AND conectada=1').get(courseId) as { pasta: string } | undefined;
  return r?.pasta ?? null;
}

/** Dentro de alguma pasta conectada: é da pessoa, e o app não mexe. */
export function protegido(db: Db, arquivo: string): boolean {
  const pastas = db.prepare('SELECT pasta FROM pastas_baixadas WHERE conectada=1').all() as Array<{ pasta: string }>;
  return pastas.some(({ pasta }) => dentro(arquivo, pasta));
}

// Os nomes vêm do dono da pasta do Drive ou do grupo: nada de "..", separador ou
// caractere que o Windows recusa, nem ponto ou espaço no fim. O teto de tamanho
// guarda a extensão: sem ela o player não saberia o tipo.
export const sanear = (nome: string, max = 150): string => {
  let n =
    nome
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .trim()
      .replace(/^\.+$/, '_') || '_';
  if (n.length > max) {
    const ext = path.extname(n).slice(0, 10);
    n = n.slice(0, max - ext.length).trimEnd() + ext;
  }
  return n;
};

// "Aula.mp4" → "Aula (2).mp4".
const comNumero = (arquivo: string, n: number) => {
  const ext = path.extname(arquivo);
  return `${arquivo.slice(0, arquivo.length - ext.length)} (${n})${ext}`;
};

/**
 * A pasta do curso dentro da raiz atual, criada no primeiro download: o título
 * de agora, com " (2)" se outro curso já usa o nome. Uma pasta com o nome que
 * não é de nenhum curso é reaproveitada (é deste, de antes de limpar ou de
 * trocar a raiz e voltar).
 */
export function pastaDoCurso(db: Db, config: AppConfig, courseId: string): string {
  const raiz = pastaDeArmazenamento(db, config);
  const r = db.prepare('SELECT raiz, pasta FROM pastas_baixadas WHERE course_id=?').get(courseId) as
    | { raiz: string; pasta: string }
    | undefined;
  if (r && r.raiz === raiz) return r.pasta;
  const conectada = pastaConectada(db, courseId);
  if (conectada) return conectada;
  const curso = db.prepare('SELECT title FROM courses WHERE id=?').get(courseId) as { title: string } | undefined;
  const base = path.join(raiz, sanear(curso?.title ?? courseId, 120));
  const deOutro = db.prepare('SELECT 1 FROM pastas_baixadas WHERE raiz=? AND lower(pasta)=lower(?) AND course_id<>?');
  let pasta = base;
  for (let n = 2; deOutro.get(raiz, pasta, courseId); n++) pasta = `${base} (${n})`;
  db.prepare(
    'INSERT INTO pastas_baixadas (course_id, raiz, pasta) VALUES (?, ?, ?) ON CONFLICT(course_id) DO UPDATE SET raiz=excluded.raiz, pasta=excluded.pasta',
  ).run(courseId, raiz, pasta);
  return pasta;
}

/**
 * Onde este item vai ser gravado. Precisa dar o mesmo caminho a cada chamada
 * (o `.part` de um download interrompido é retomado dele), então só depende do
 * rel_path e do que já está registrado. Dois itens que viram o mesmo nome
 * (saneamento, maiúsculas num disco que não as distingue) ganham " (2)".
 */
export function destinoDe(db: Db, config: AppConfig, item: ItemBaixavel): string {
  const pasta = pastaDoCurso(db, config, item.courseId);
  const partes = item.relPath.split('/').filter(Boolean).map((p) => sanear(p));
  const base = path.join(pasta, ...partes);
  // Saneado, não escapa; a conferência fica como a última barreira.
  if (!dentro(base, pasta)) throw new Error('caminho fora da pasta do curso');
  const deOutro = db.prepare('SELECT 1 FROM baixados WHERE lower(arquivo)=lower(?) AND NOT (tipo=? AND item_id=?)');
  // Na pasta conectada, um arquivo da pessoa com o mesmo nome e outro tamanho
  // não é este item: o download vai para "Nome (2)" em vez de gravar por cima.
  const conectada = pastaConectada(db, item.courseId) !== null;
  const ocupado = (d: string) => {
    if (!conectada || item.tamanho <= 0) return false;
    try {
      return fs.statSync(d).size !== item.tamanho;
    } catch {
      return false;
    }
  };
  let destino = base;
  for (let n = 2; deOutro.get(destino, item.tipo, item.id) || ocupado(destino); n++) destino = comNumero(base, n);
  return destino;
}

export function registrarBaixado(db: Db, item: Pick<ItemBaixavel, 'tipo' | 'id' | 'courseId'>, arquivo: string, convertido = false): void {
  db.prepare(
    `INSERT INTO baixados (tipo, item_id, course_id, arquivo, convertido) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tipo, item_id) DO UPDATE SET course_id=excluded.course_id, arquivo=excluded.arquivo, convertido=excluded.convertido`,
  ).run(item.tipo, item.id, item.courseId, arquivo, convertido ? 1 : 0);
}

/**
 * O arquivo baixado deste item, se ainda está lá e na raiz atual. null = não
 * baixado (nunca foi, a pessoa moveu ou a raiz mudou).
 */
export function arquivoBaixado(db: Db, config: AppConfig, tipo: TipoBaixado, id: string): { arquivo: string; convertido: boolean } | null {
  // Configs montadas à mão nos testes antigos não têm a pasta: sem ela, nada é local.
  if (!config.downloadsDir) return null;
  const r = db.prepare('SELECT arquivo, convertido, course_id FROM baixados WHERE tipo=? AND item_id=?').get(tipo, id) as
    | { arquivo: string; convertido: number; course_id: string }
    | undefined;
  if (!r) return null;
  const conectada = pastaConectada(db, r.course_id);
  const naRaiz = dentro(r.arquivo, pastaDeArmazenamento(db, config)) || (!!conectada && dentro(r.arquivo, conectada));
  const existe = naRaiz && fs.existsSync(r.arquivo);
  if (tipo === 'aula' && r.convertido) {
    // Só a cópia convertida tocava: sem ela, a aula volta a dizer que não toca
    // (e é convertida de novo quando for baixada), em vez de abrir um player quebrado.
    db.prepare('UPDATE lessons SET playable=? WHERE id=? AND playable<>?').run(existe ? 1 : 0, id, existe ? 1 : 0);
  }
  // Tirada da pasta pela pessoa: esquece, para baixar de novo com o nome original.
  if (naRaiz && !existe) db.prepare('DELETE FROM baixados WHERE tipo=? AND item_id=?').run(tipo, id);
  return existe ? { arquivo: r.arquivo, convertido: !!r.convertido } : null;
}

/** Os ids das aulas baixadas do curso (para pintar as outras de cinza). */
export function aulasBaixadas(db: Db, config: AppConfig, courseId: string): Set<string> {
  const ids = db.prepare("SELECT item_id FROM baixados WHERE course_id=? AND tipo='aula'").all(courseId) as Array<{ item_id: string }>;
  return new Set(ids.map((r) => r.item_id).filter((id) => arquivoBaixado(db, config, 'aula', id)));
}

// Nomes que o Telegram dá quando o arquivo não tem nome: casar por eles juntaria
// aulas diferentes. Nesses, só o caminho exato ou o tamanho valem.
const NOMES_GENERICOS = new Set(['video', 'foto', 'arquivo', 'photo', 'image', 'img', 'file', 'documento', 'audio']);
const VIDEO = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi', '.flv', '.wmv', '.ts', '.mpg', '.mpeg']);
const IMAGEM = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const categoria = (ext: string) => (VIDEO.has(ext) ? 'video' : IMAGEM.has(ext) ? 'imagem' : ext);
// "0000012345-Aula 01 – Introdução.mp4" e "aula_01_introducao.MP4" viram "aula01introducao".
const nomeComparavel = (arquivo: string) =>
  path
    .basename(arquivo, path.extname(arquivo))
    .replace(/^\d{10}-/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
// Abaixo disso, dois arquivos diferentes com o mesmo tamanho não são raros (fotos pequenas, PDFs de uma página).
const TAMANHO_QUE_IDENTIFICA = 256 * 1024;
const PROFUNDIDADE_MAXIMA = 8;
const ARQUIVOS_NO_MAXIMO = 50_000;

interface ArquivoDaPasta {
  arquivo: string;
  nome: string;
  ext: string;
  tamanho: number;
}

// Só lê: nada é criado nem alterado. Pastas e arquivos ocultos ficam de fora, e `.part` também.
function listarPasta(pasta: string): ArquivoDaPasta[] {
  const lista: ArquivoDaPasta[] = [];
  const andar = (dir: string, nivel: number) => {
    if (nivel > PROFUNDIDADE_MAXIMA || lista.length >= ARQUIVOS_NO_MAXIMO) return;
    let itens: fs.Dirent[];
    try {
      itens = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      if (it.name.startsWith('.') || it.name.endsWith('.part')) continue;
      const p = path.join(dir, it.name);
      if (it.isDirectory()) andar(p, nivel + 1);
      else if (it.isFile()) {
        const ext = path.extname(it.name).toLowerCase();
        lista.push({ arquivo: p, nome: nomeComparavel(it.name), ext, tamanho: tamanhoDe(p) });
      }
    }
  };
  andar(pasta, 0);
  return lista;
}

const ultimaAdocao = new Map<string, number>();
const ADOCAO_NO_MAXIMO_A_CADA_MS = 60_000;

/**
 * Arquivos que já estão na pasta do curso sem registro: o curso foi excluído e
 * importado de novo (os ids mudam, a pasta e os nomes não), a pessoa conectou
 * uma pasta onde já tinha baixado o conteúdo, ou copiou a pasta de outra
 * máquina. Cada aula e material que acha o seu arquivo passa a contar como
 * baixado, em vez de ser baixado de novo (e duplicado). A ordem de confiança:
 * o caminho exato; o mesmo tamanho em bytes (arquivo grande, um só na pasta); o
 * mesmo nome, sem acento, pontuação nem o número da mensagem do Telegram (um só
 * na pasta, e não um nome genérico como "video"). Cada arquivo serve a um item.
 * Sem pasta com o nome do curso, não faz nada (e não reserva o nome).
 * `sempre` ignora o intervalo mínimo entre duas leituras da pasta (que é cara numa pasta grande).
 */
export function adotarArquivosDaPasta(db: Db, config: AppConfig, courseId: string, sempre = false): number {
  if (!config.downloadsDir) return 0;
  const agora = Date.now();
  if (!sempre && agora - (ultimaAdocao.get(courseId) ?? 0) < ADOCAO_NO_MAXIMO_A_CADA_MS) return 0;
  ultimaAdocao.set(courseId, agora);

  const raiz = pastaDeArmazenamento(db, config);
  const conectada = pastaConectada(db, courseId);
  if (!conectada) {
    const mapeada = db.prepare('SELECT pasta FROM pastas_baixadas WHERE course_id=? AND raiz=?').get(courseId, raiz) as { pasta: string } | undefined;
    if (!mapeada) {
      const curso = db.prepare('SELECT title FROM courses WHERE id=?').get(courseId) as { title: string } | undefined;
      if (!curso || !fs.existsSync(path.join(raiz, sanear(curso.title, 120)))) return 0;
    }
  }
  const pasta = pastaDoCurso(db, config, courseId);
  if (!fs.existsSync(pasta)) return 0;

  const registrados = new Set(
    (db.prepare('SELECT tipo, item_id FROM baixados WHERE course_id=?').all(courseId) as Array<{ tipo: string; item_id: string }>).map(
      (r) => `${r.tipo}:${r.item_id}`,
    ),
  );
  // Arquivos que já são de algum item (deste ou de outro curso) não são adotados de novo.
  const usados = new Set((db.prepare('SELECT arquivo FROM baixados').all() as Array<{ arquivo: string }>).map((r) => r.arquivo));
  type Linha = { id: string; rel_path: string; remote_id: string | null; size_bytes: number | null };
  const aulas = db.prepare('SELECT id, rel_path, remote_id, size_bytes FROM lessons WHERE course_id=?').all(courseId) as Linha[];
  const materiais = db.prepare('SELECT id, rel_path, remote_id, size_bytes FROM materials WHERE course_id=?').all(courseId) as Linha[];
  const faltam = [
    ...aulas.map((l) => ['aula', l] as const),
    ...materiais.map((l) => ['material', l] as const),
  ].filter(([tipo, l]) => !registrados.has(`${tipo}:${l.id}`));
  if (!faltam.length) return 0;

  let naPasta: ArquivoDaPasta[] | null = null;
  const livres = () => (naPasta ??= listarPasta(pasta)).filter((f) => !usados.has(f.arquivo));
  const toca = db.prepare('UPDATE lessons SET playable=1 WHERE id=?');
  let adotados = 0;

  for (const [tipo, l] of faltam) {
    const item: ItemBaixavel = { tipo, id: l.id, courseId, relPath: l.rel_path, remoteId: l.remote_id ?? '', tamanho: Number(l.size_bytes ?? 0) };
    const extItem = path.extname(l.rel_path).toLowerCase();
    let achado: { arquivo: string; convertido: boolean } | null = null;

    // 1. O caminho exato. O download grava no `.part` e só renomeia no fim: com o
    // nome final, está inteiro. Tamanho diferente numa aula = convertida no lugar.
    const destino = destinoDe(db, config, item);
    if (!usados.has(destino)) {
      try {
        const t = fs.statSync(destino).size;
        if (!conectada || item.tamanho <= 0 || t === item.tamanho) achado = { arquivo: destino, convertido: tipo === 'aula' && item.tamanho > 0 && t !== item.tamanho };
      } catch {
        // Aula que não tocava (MPEG-TS) ficou na pasta como o .mp4 convertido.
        const mp4 = destino.slice(0, destino.length - path.extname(destino).length) + '.mp4';
        if (tipo === 'aula' && mp4 !== destino && !usados.has(mp4) && fs.existsSync(mp4)) achado = { arquivo: mp4, convertido: true };
      }
    }

    // 2. O mesmo tamanho em bytes, com o mesmo tipo de arquivo: o nome pode ser
    // outro (o Telegram Desktop salva "video_2024-03-01.mp4").
    if (!achado && item.tamanho >= TAMANHO_QUE_IDENTIFICA) {
      const mesmos = livres().filter((f) => f.tamanho === item.tamanho && categoria(f.ext) === categoria(extItem));
      const escolhido = mesmos.length === 1 ? mesmos[0] : mesmos.find((f) => f.nome === nomeComparavel(l.rel_path));
      if (escolhido) achado = { arquivo: escolhido.arquivo, convertido: false };
    }

    // 3. O mesmo nome: com outra extensão só se for o .mp4 de uma aula (a cópia convertida).
    if (!achado) {
      const nome = nomeComparavel(l.rel_path);
      if (nome.length >= 4 && !NOMES_GENERICOS.has(nome)) {
        const mesmos = livres().filter(
          (f) => f.nome === nome && (f.ext === extItem || (tipo === 'aula' && f.ext === '.mp4' && categoria(extItem) === 'video')),
        );
        if (mesmos.length === 1) achado = { arquivo: mesmos[0].arquivo, convertido: tipo === 'aula' && mesmos[0].ext !== extItem };
      }
    }

    if (!achado) continue;
    registrarBaixado(db, item, achado.arquivo, achado.convertido);
    usados.add(achado.arquivo);
    if (achado.convertido) toca.run(l.id);
    adotados++;
  }
  return adotados;
}

function tamanhoDe(arquivo: string): number {
  try {
    return fs.statSync(arquivo).size;
  } catch {
    return 0;
  }
}

export interface UsoDoCurso {
  courseId: string;
  titulo: string;
  bytes: number;
  arquivos: number;
  pasta: string | null;
}

/** O que está baixado na raiz atual, por curso, para as Configurações. */
export function usoDoArmazenamento(db: Db, config: AppConfig): { pasta: string; padrao: boolean; bytes: number; livre: number | null; cursos: UsoDoCurso[] } {
  const raiz = pastaDeArmazenamento(db, config);
  const linhas = db
    .prepare(
      `SELECT b.course_id, b.arquivo, c.title, p.pasta, p.raiz FROM baixados b JOIN courses c ON c.id = b.course_id
       LEFT JOIN pastas_baixadas p ON p.course_id = b.course_id`,
    )
    .all() as Array<{ course_id: string; arquivo: string; title: string; pasta: string | null; raiz: string | null }>;
  const cursos = new Map<string, UsoDoCurso>();
  for (const l of linhas) {
    if (!dentro(l.arquivo, raiz)) continue;
    const b = tamanhoDe(l.arquivo);
    if (!b && !fs.existsSync(l.arquivo)) continue;
    const c = cursos.get(l.course_id) ?? { courseId: l.course_id, titulo: l.title, bytes: 0, arquivos: 0, pasta: l.raiz === raiz ? l.pasta : null };
    c.bytes += b;
    c.arquivos++;
    cursos.set(l.course_id, c);
  }
  let livre: number | null = null;
  try {
    const s = fs.statfsSync(fs.existsSync(raiz) ? raiz : path.dirname(raiz));
    livre = s.bavail * s.bsize;
  } catch {
    /* disco desconectado: só não mostra o espaço livre */
  }
  const lista = [...cursos.values()].sort((a, b) => b.bytes - a.bytes);
  return {
    pasta: raiz,
    padrao: raiz === config.downloadsDir,
    bytes: lista.reduce((s, c) => s + c.bytes, 0),
    livre,
    cursos: lista,
  };
}

// Sobe apagando as pastas que ficaram vazias, até a raiz (exclusive).
// O que o sistema cria sozinho numa pasta aberta no Finder ou no Explorer: não
// conta como conteúdo, senão a pasta do curso excluído ficava para trás.
const LIXO_DO_SISTEMA = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function apagarVazias(dir: string, raiz: string): void {
  while (dentro(dir, raiz)) {
    try {
      const itens = fs.readdirSync(dir);
      if (itens.some((n) => !LIXO_DO_SISTEMA.has(n))) return;
      for (const n of itens) fs.rmSync(path.join(dir, n), { force: true });
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

// Os `.part` que um download interrompido deixou na pasta do curso.
function apagarParciais(dir: string): void {
  let itens: fs.Dirent[];
  try {
    itens = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of itens) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) apagarParciais(p);
    else if (it.name.endsWith('.part')) fs.rmSync(p, { force: true });
  }
}

/**
 * Apaga o que o app baixou deste curso na raiz atual (ou de todos, sem
 * courseId). Só os arquivos que ele mesmo gravou e os `.part`: a raiz pode ser
 * uma pasta da pessoa com outras coisas dentro.
 */
export function apagarBaixados(db: Db, config: AppConfig, courseId?: string): void {
  const raiz = pastaDeArmazenamento(db, config);
  const linhas = (
    courseId
      ? db.prepare('SELECT tipo, item_id, arquivo, convertido FROM baixados WHERE course_id=?').all(courseId)
      : db.prepare('SELECT tipo, item_id, arquivo, convertido FROM baixados').all()
  ) as Array<{ tipo: TipoBaixado; item_id: string; arquivo: string; convertido: number }>;
  const pastas = (
    courseId
      ? db.prepare('SELECT pasta FROM pastas_baixadas WHERE raiz=? AND course_id=? AND conectada=0').all(raiz, courseId)
      : db.prepare('SELECT pasta FROM pastas_baixadas WHERE raiz=? AND conectada=0').all(raiz)
  ) as Array<{ pasta: string }>;
  const tirar = db.prepare('DELETE FROM baixados WHERE tipo=? AND item_id=?');
  const naoToca = db.prepare('UPDATE lessons SET playable=0 WHERE id=?');
  for (const l of linhas) {
    // Na pasta conectada, os arquivos são da pessoa: "Limpar tudo" não os toca nem os esquece.
    if (!dentro(l.arquivo, raiz) || protegido(db, l.arquivo)) continue;
    fs.rmSync(l.arquivo, { force: true });
    tirar.run(l.tipo, l.item_id);
    if (l.tipo === 'aula' && l.convertido) naoToca.run(l.item_id);
    apagarVazias(path.dirname(l.arquivo), raiz);
  }
  for (const { pasta } of pastas) {
    apagarParciais(pasta);
    apagarVazias(pasta, raiz);
    // Pastas de módulo vazias que só tinham `.part`.
    try {
      for (const d of fs.readdirSync(pasta, { withFileTypes: true })) if (d.isDirectory()) apagarVazias(path.join(pasta, d.name), raiz);
      apagarVazias(pasta, raiz);
    } catch {
      /* já não existe */
    }
  }
}

/** Apaga a cópia baixada de um item (e o `.part`, se o download parou no meio). */
export function apagarBaixado(db: Db, config: AppConfig, item: Pick<ItemBaixavel, 'tipo' | 'id' | 'courseId' | 'relPath'>): void {
  const raiz = pastaDeArmazenamento(db, config);
  const r = db.prepare('SELECT arquivo, convertido FROM baixados WHERE tipo=? AND item_id=?').get(item.tipo, item.id) as
    | { arquivo: string; convertido: number }
    | undefined;
  // Pasta conectada: o arquivo é da pessoa (ou foi acrescentado a pedido dela) e fica.
  if (pastaConectada(db, item.courseId)) return;
  if (r && dentro(r.arquivo, raiz)) {
    fs.rmSync(r.arquivo, { force: true });
    db.prepare('DELETE FROM baixados WHERE tipo=? AND item_id=?').run(item.tipo, item.id);
    if (item.tipo === 'aula' && r.convertido) db.prepare('UPDATE lessons SET playable=0 WHERE id=?').run(item.id);
    apagarVazias(path.dirname(r.arquivo), raiz);
  }
  // O `.part` fica onde o download estava gravando.
  const pasta = db.prepare('SELECT pasta FROM pastas_baixadas WHERE course_id=? AND raiz=?').get(item.courseId, raiz) as { pasta: string } | undefined;
  if (pasta) {
    const parcial = path.join(pasta.pasta, ...item.relPath.split('/').filter(Boolean).map((p) => sanear(p))) + '.part';
    if (dentro(parcial, raiz)) fs.rmSync(parcial, { force: true });
  }
}

/**
 * Troca o original pela cópia convertida, no mesmo lugar e com o mesmo nome
 * (só a extensão vira .mp4). Devolve o caminho final.
 */
export function adotarConvertido(db: Db, item: Pick<ItemBaixavel, 'tipo' | 'id' | 'courseId'>, original: string, convertido: string): string {
  // Pasta conectada: o original fica como está, e a cópia que toca mora em
  // DATA_DIR/converted, como a de um curso local (o stream a prefere).
  if (protegido(db, original)) {
    const final = path.join(path.dirname(convertido), `${item.id}.mp4`);
    fs.renameSync(convertido, final);
    db.prepare('UPDATE lessons SET playable=1 WHERE id=?').run(item.id);
    return final;
  }
  let final = original.slice(0, original.length - path.extname(original).length) + '.mp4';
  // Outra aula já tem esse nome (Aula.mkv e Aula.mp4 lado a lado).
  if (final !== original && fs.existsSync(final)) final = comNumero(final, 2);
  fs.renameSync(convertido, final);
  if (final !== original) fs.rmSync(original, { force: true });
  registrarBaixado(db, item, final, true);
  db.prepare('UPDATE lessons SET playable=1 WHERE id=?').run(item.id);
  return final;
}

/**
 * Depois de um re-escaneio que mudou a estrutura (o grupo do Telegram ganhou
 * módulos por tópico, a pasta do Drive foi reorganizada), leva os arquivos já
 * baixados para onde o app os gravaria agora: <curso>/<módulo>/<arquivo>. Só
 * renomeia dentro da pasta de armazenamento; nunca grava por cima de outro
 * arquivo, e a pasta conectada é da pessoa, então nela nada se move. O `.part`
 * de um download que parou também vai, para continuar de onde estava.
 * `simular` só conta, sem mover (para saber se vale pausar os downloads).
 */
export function reorganizarBaixados(db: Db, config: AppConfig, courseId: string, simular = false): number {
  if (!config.downloadsDir || pastaConectada(db, courseId)) return 0;
  const raiz = pastaDeArmazenamento(db, config);
  const mapeada = db.prepare('SELECT pasta FROM pastas_baixadas WHERE course_id=? AND raiz=?').get(courseId, raiz) as { pasta: string } | undefined;
  if (!mapeada || !fs.existsSync(mapeada.pasta)) return 0;

  type Linha = { id: string; rel_path: string; remote_id: string | null; size_bytes: number | null };
  const itens = [
    ...(db.prepare('SELECT id, rel_path, remote_id, size_bytes FROM lessons WHERE course_id=?').all(courseId) as Linha[]).map((l) => ['aula', l] as const),
    ...(db.prepare('SELECT id, rel_path, remote_id, size_bytes FROM materials WHERE course_id=?').all(courseId) as Linha[]).map((l) => ['material', l] as const),
  ];
  const registro = db.prepare('SELECT arquivo, convertido FROM baixados WHERE tipo=? AND item_id=?');
  const atualizar = db.prepare('UPDATE baixados SET arquivo=? WHERE tipo=? AND item_id=?');
  const mover = (de: string, para: string) => {
    fs.mkdirSync(path.dirname(para), { recursive: true });
    try {
      fs.renameSync(de, para);
    } catch {
      // Outro disco (não deveria, é a mesma raiz): copia e apaga.
      fs.copyFileSync(de, para);
      fs.rmSync(de, { force: true });
    }
    apagarVazias(path.dirname(de), raiz);
  };

  let movidos = 0;
  for (const [tipo, l] of itens) {
    const item: ItemBaixavel = { tipo, id: l.id, courseId, relPath: l.rel_path, remoteId: l.remote_id ?? '', tamanho: Number(l.size_bytes ?? 0) };
    let ideal = destinoDe(db, config, item);
    const r = registro.get(tipo, l.id) as { arquivo: string; convertido: number } | undefined;
    if (r) {
      // Aula convertida: o arquivo é o .mp4 com o nome do original.
      if (r.convertido) ideal = ideal.slice(0, ideal.length - path.extname(ideal).length) + '.mp4';
      if (r.arquivo === ideal || !dentro(r.arquivo, raiz) || !fs.existsSync(r.arquivo) || fs.existsSync(ideal)) continue;
      movidos++;
      if (simular) continue;
      mover(r.arquivo, ideal);
      atualizar.run(ideal, tipo, l.id);
    } else {
      // Download que parou no meio, gravado no lugar antigo (na raiz do curso, sem módulo).
      const antigo = path.join(mapeada.pasta, sanear(path.basename(l.rel_path))) + '.part';
      const novo = `${ideal}.part`;
      if (antigo === novo || !fs.existsSync(antigo) || fs.existsSync(novo)) continue;
      movidos++;
      if (simular) continue;
      mover(antigo, novo);
    }
  }
  return movidos;
}

/**
 * Onde gravar a conversão de um arquivo baixado: ao lado dele (o rename final não
 * cruza discos) ou, na pasta conectada, em DATA_DIR/converted, para não criar
 * nada temporário na pasta da pessoa.
 */
export function saidaDaConversao(db: Db, config: AppConfig, id: string, original: string): string {
  if (protegido(db, original)) return path.join(config.convertedDir, `${id}.convertendo.mp4`);
  return original.slice(0, original.length - path.extname(original).length) + '.convertendo.mp4';
}

const CHAVE_LEGADO = 'armazenamento.legado';

/**
 * Uma vez, ao abrir a primeira versão com a pasta de armazenamento: o cache
 * antigo (DATA_DIR/downloads/<id do curso>/<id da aula>, e a cópia convertida
 * em converted/) vira a nova pasta, com os nomes reais, em vez de ser baixado de
 * novo. O que sobrar dele (`.part`) sai.
 */
export function migrarCacheAntigo(db: Db, config: AppConfig): void {
  if (!config.downloadsDir) return;
  if (db.prepare('SELECT 1 FROM settings WHERE key=?').get(CHAVE_LEGADO)) return;
  const extensao = (relPath: string) => {
    const ext = path.extname(relPath).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
  };
  const cursos = db.prepare("SELECT id FROM courses WHERE source IN ('drive','telegram')").all() as Array<{ id: string }>;
  for (const { id: courseId } of cursos) {
    const antiga = path.join(config.downloadsDir, courseId);
    const aulas = db.prepare('SELECT id, rel_path, remote_id, size_bytes FROM lessons WHERE course_id=?').all(courseId) as Array<{
      id: string;
      rel_path: string;
      remote_id: string | null;
      size_bytes: number | null;
    }>;
    const materiais = db.prepare('SELECT id, rel_path, remote_id, size_bytes FROM materials WHERE course_id=?').all(courseId) as typeof aulas;
    const mover = (de: string, item: ItemBaixavel, convertido: boolean) => {
      if (!fs.existsSync(de)) return false;
      try {
        let para = destinoDe(db, config, item);
        if (convertido) para = para.slice(0, para.length - path.extname(para).length) + '.mp4';
        fs.mkdirSync(path.dirname(para), { recursive: true });
        try {
          fs.renameSync(de, para);
        } catch {
          // Outro disco (DATA_DIR num volume, a raiz noutro): copia e apaga.
          fs.copyFileSync(de, para);
          fs.rmSync(de, { force: true });
        }
        registrarBaixado(db, item, para, convertido);
        return true;
      } catch {
        return false;
      }
    };
    for (const a of aulas) {
      const item: ItemBaixavel = { tipo: 'aula', id: a.id, courseId, relPath: a.rel_path, remoteId: a.remote_id ?? '', tamanho: Number(a.size_bytes ?? 0) };
      const conv = path.join(config.convertedDir, `${a.id}.mp4`);
      if (!mover(conv, item, true)) mover(path.join(antiga, `${a.id}${extensao(a.rel_path)}`), item, false);
    }
    for (const m of materiais) {
      const item: ItemBaixavel = { tipo: 'material', id: m.id, courseId, relPath: m.rel_path, remoteId: m.remote_id ?? '', tamanho: Number(m.size_bytes ?? 0) };
      mover(path.join(antiga, `m-${m.id}${extensao(m.rel_path)}`), item, false);
    }
    fs.rmSync(antiga, { recursive: true, force: true });
  }
  // Os pedidos do antigo "Baixar para Downloads" não continuam: agora iriam para outro lugar.
  db.prepare("DELETE FROM settings WHERE key='exportacoes.pendentes'").run();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(CHAVE_LEGADO, '1');
}
