import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { Capacidades } from '../media/ffmpeg';
import { prepararParaTocar } from '../media/preparar';
import type { ClienteDrive } from './api';
import {
  adotarConvertido,
  arquivoBaixado,
  destinoDe,
  pastaDeArmazenamento,
  pastaDoCurso,
  registrarBaixado,
  type ItemBaixavel,
} from '../armazenamento';
import { FalhaDrive } from './tipos';
import { FalhaTelegram } from '../telegram/tipos';

// Os downloads das aulas e materiais do Drive e do Telegram, todos para a pasta
// de armazenamento (armazenamento.ts), numa fila só. Assistir pela rede dependia
// da cota do Google (que bloqueia pastas muito acessadas), de conexão boa e do
// seek ir e voltar ao Drive; com o arquivo local, o player é o mesmo dos cursos
// do disco. Enquanto uma aula não chega, ela continua tocando pela rede.
//
// Dois tipos de pedido, na mesma fila para nunca baixarem o mesmo arquivo ao
// mesmo tempo (antes eram duas filas, e isso acontecia):
// - a janela: abrir uma aula baixa ela e as JANELA seguintes. É o que passa na
//   frente: abrir a aula 30 no meio do curso inteiro interrompe o arquivo atual
//   (o `.part` fica), baixa a 30 e as próximas, e volta de onde parou;
// - o curso inteiro ("Baixar curso inteiro"), aulas e materiais, um curso por
//   vez, com progresso, retomada ao abrir o app e novas tentativas sozinho.
// Nada é apagado aqui: o que foi baixado fica até a pessoa remover.

const CHAVE_HEVC = 'player.hevc';
/** Aulas seguintes à aberta que já vão sendo baixadas. */
export const JANELA = 2;

/** O que o player desta máquina toca, informado pela interface ao abrir. */
export function capacidadesSalvas(db: Db): Capacidades {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE_HEVC) as { value: string } | undefined;
  return { hevc: r?.value === '1' };
}

export function salvarCapacidades(db: Db, cap: Capacidades): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    CHAVE_HEVC,
    cap.hevc ? '1' : '0',
  );
}

/**
 * Baixa um arquivo da origem para `destino`, retomando um `destino.part` que já exista.
 * `signal` interrompe no meio (cancelar, ou a aula aberta passando na frente).
 */
export type BaixarArquivo = (remoteId: string, destino: string, tamanho: number, signal?: AbortSignal) => Promise<void>;

export const baixarDoDrive = (cliente: ClienteDrive): BaixarArquivo => async (remoteId, destino, tamanho, signal) => {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const parcial = `${destino}.part`;
  // Retoma de onde parou: vídeo de aula tem centenas de MB, e cair a rede no
  // meio não pode custar o download inteiro.
  let inicio = fs.existsSync(parcial) ? fs.statSync(parcial).size : 0;
  let res = await cliente.baixar(remoteId, inicio ? `bytes=${inicio}-` : undefined, signal);
  if (inicio && res.status === 416) {
    // O pedaço já estava completo; só faltou renomear.
    await res.body?.cancel();
  } else {
    if (inicio && res.status !== 206) {
      await res.body?.cancel();
      inicio = 0;
      res = await cliente.baixar(remoteId, undefined, signal);
    }
    if (!res.ok || !res.body) throw new FalhaDrive('sem-conexao');
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      fs.createWriteStream(parcial, { flags: inicio ? 'a' : 'w' }),
      { signal },
    );
  }
  // Arquivo truncado tocaria até o meio e pararia: confere com o tamanho do Drive.
  if (tamanho > 0 && fs.statSync(parcial).size !== tamanho) {
    fs.rmSync(parcial, { force: true });
    throw new FalhaDrive('sem-conexao');
  }
  fs.renameSync(parcial, destino);
};

export interface EstadoJanela {
  /** Baixando a aula aberta ou as próximas deste curso. */
  ativo: boolean;
  /** Motivo da última parada (tipo de FalhaDrive/FalhaTelegram, 'sem-espaco'), ou null. */
  erro: string | null;
}

/** O curso inteiro pedido, para o painel de downloads. */
export interface EstadoDownload {
  courseId: string;
  titulo: string;
  origem: 'drive' | 'telegram';
  ativo: boolean;
  /** Pedido, mas esperando outro curso terminar. */
  naFila: boolean;
  /** Parou porque a pessoa cancelou. */
  cancelado: boolean;
  /** O arquivo sendo baixado agora (nome, sem a pasta). */
  arquivo: string | null;
  /** Bytes por segundo nos últimos segundos; null antes de dar para medir. */
  velocidade: number | null;
  feitos: number;
  total: number;
  bytesFeitos: number;
  bytesTotal: number;
  /** Motivo da parada (tipo de FalhaDrive/FalhaTelegram, 'sem-espaco'), ou null. */
  erro: string | null;
  /** Parou por uma falha que passa sozinha: quando tenta de novo (ms desde 1970), ou null. */
  tentarEm: number | null;
  /** A pasta do curso dentro da pasta de armazenamento. */
  pasta: string;
}

export interface Baixador {
  /** A pessoa abriu esta aula: baixa ela e as próximas JANELA não concluídas, antes de tudo. */
  pedirAula(lessonId: string): void;
  janela(courseId: string): EstadoJanela;
  /** Aulas e materiais do curso todo. */
  baixarCurso(courseId: string): void;
  /** Para de baixar o curso (o inteiro e a janela). O `.part` fica: pedir de novo continua dele. */
  cancelar(courseId: string): void;
  /** Espera o arquivo deste curso que estava sendo gravado parar (antes de apagar a pasta). */
  soltar(courseId: string): Promise<void>;
  estado(courseId: string): EstadoDownload | null;
  /** Todos os pedidos de curso inteiro desde que o app abriu (menos os dispensados), na ordem do pedido. */
  todos(): EstadoDownload[];
  /** Ao abrir o app: retoma os cursos inteiros que não terminaram (app fechado, queda de energia). */
  retomar(): void;
  /** Tira da lista um que já parou (o "×" do painel). */
  dispensar(courseId: string): void;
  /** Baixando um curso inteiro, na fila ou esperando para tentar de novo. */
  ocupado(): boolean;
  /**
   * Para tudo e espera parar (trocar a pasta, limpar). Devolve os cursos inteiros
   * que estavam pedidos; `esquecer` desiste deles (não voltam ao abrir o app).
   */
  pararTudo(esquecer: boolean): Promise<string[]>;
  /** Para os testes: espera a fila esvaziar. */
  aguardar(): Promise<void>;
}

// Os cursos inteiros pedidos e ainda não terminados, na ordem do pedido. Ficam no
// banco para o app retomar ao abrir: um curso de 100 GB leva o dia, e fechar o
// app (ou o computador dormir e reiniciar) não pode exigir lembrar de clicar de novo.
const CHAVE_PENDENTES = 'downloads.pendentes';

// Falhas que passam sozinhas (rede, limite do Telegram, cota do Google): tenta de
// novo depois de um tempo. As outras (sem espaço, sem acesso, sessão caiu)
// esperam a pessoa resolver e clicar em Continuar.
const ESPERA_POR_FALHA: Record<string, number> = {
  'sem-conexao': 30_000,
  telegram: 30_000,
  google: 30_000,
  flood: 60_000,
  'cota-esgotada': 10 * 60_000,
};
/** Falhas seguidas sem nenhum arquivo novo até desistir e esperar a pessoa. */
const MAX_TENTATIVAS = 5;

// Motivos de abortar o arquivo em andamento: a pessoa abriu outra aula (volta a
// ele depois) ou mandou parar.
const PASSAR_NA_FRENTE = 'passar-na-frente';
const PARAR = 'parar';

const motivo = (e: unknown): string =>
  e instanceof FalhaDrive || e instanceof FalhaTelegram
    ? e.tipo
    : (e as NodeJS.ErrnoException)?.code === 'ENOSPC'
      ? 'sem-espaco'
      : 'sem-conexao';

type Linha = { id: string; rel_path: string; remote_id: string; size_bytes: number | null };

export function criarBaixador(deps: {
  db: Db;
  config: AppConfig;
  /** Como baixar os arquivos deste curso (Drive ou Telegram); null = curso sem origem remota. */
  fonte: (courseId: string) => Promise<BaixarArquivo | null>;
}): Baixador {
  const { db, config } = deps;
  const fila: string[] = [];
  const estados = new Map<string, EstadoDownload>();
  // As aulas da janela que ainda faltam, na ordem; trocada inteira a cada aula aberta.
  let janela: ItemBaixavel[] = [];
  const janelas = new Map<string, EstadoJanela>();
  // O arquivo sendo gravado agora, de qualquer pedido.
  let atual: { item: ItemBaixavel; ac: AbortController } | null = null;
  let cursoAtual: { id: string; ac: AbortController } | null = null;
  let rodando: Promise<void> | null = null;
  // A fonte é montada uma vez por volta da fila: no Telegram ela abre a conexão.
  const fontes = new Map<string, Promise<BaixarArquivo | null>>();
  // O `.part` do arquivo em andamento do curso inteiro: o tamanho dele é o
  // progresso dentro do arquivo (um vídeo de 1 GB deixaria a barra parada por minutos).
  const parciais = new Map<string, string>();
  // Amostras (hora, bytes) para a velocidade: a média dos últimos segundos, e não
  // a do arquivo inteiro, para refletir a rede de agora.
  const amostras = new Map<string, Array<{ t: number; b: number }>>();
  const JANELA_MS = 6000;
  const tentativas = new Map<string, number>();
  const religar = new Map<string, NodeJS.Timeout>();

  const lerPendentes = (): string[] => {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(CHAVE_PENDENTES) as { value: string } | undefined;
    try {
      const v = r ? (JSON.parse(r.value) as unknown) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const gravarPendentes = (ids: string[]) =>
    db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(CHAVE_PENDENTES, JSON.stringify(ids));
  const marcarPendente = (id: string) => {
    const ids = lerPendentes();
    if (!ids.includes(id)) gravarPendentes([...ids, id]);
  };
  const tirarPendente = (id: string) => gravarPendentes(lerPendentes().filter((x) => x !== id));

  const fonte = (courseId: string) => {
    let f = fontes.get(courseId);
    if (!f) fontes.set(courseId, (f = deps.fonte(courseId)));
    return f;
  };

  const itemDe = (tipo: ItemBaixavel['tipo'], courseId: string, l: Linha): ItemBaixavel => ({
    tipo,
    id: l.id,
    courseId,
    relPath: l.rel_path,
    remoteId: l.remote_id,
    tamanho: Number(l.size_bytes ?? 0),
  });

  // Na ordem do curso (as primeiras aulas, que a pessoa assiste primeiro, chegam
  // antes); os materiais por último.
  function itensDoCurso(courseId: string): ItemBaixavel[] {
    const aulas = db
      .prepare('SELECT id, rel_path, remote_id, size_bytes FROM lessons WHERE course_id=? AND missing=0 AND remote_id IS NOT NULL ORDER BY order_index')
      .all(courseId) as Linha[];
    const materiais = db
      .prepare('SELECT id, rel_path, remote_id, size_bytes FROM materials WHERE course_id=? AND remote_id IS NOT NULL ORDER BY rel_path')
      .all(courseId) as Linha[];
    return [...aulas.map((a) => itemDe('aula', courseId, a)), ...materiais.map((m) => itemDe('material', courseId, m))];
  }

  async function baixarItem(item: ItemBaixavel, destino: string, signal: AbortSignal): Promise<void> {
    // Já está lá inteiro (o app fechou entre gravar e registrar): só registra.
    const inteiro = fs.existsSync(destino) && (item.tamanho <= 0 || fs.statSync(destino).size === item.tamanho);
    if (!inteiro) {
      const baixar = await fonte(item.courseId);
      if (!baixar) throw new FalhaDrive('sem-conexao');
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      await baixar(item.remoteId, destino, item.tamanho, signal);
    }
    registrarBaixado(db, item, destino);
    if (item.tipo !== 'aula') return;
    try {
      // Ao lado do original, para a troca ser um rename mesmo com a pasta em outro disco.
      const convertido = destino.slice(0, destino.length - path.extname(destino).length) + '.convertendo.mp4';
      if (await prepararParaTocar(destino, convertido, capacidadesSalvas(db))) adotarConvertido(db, item, destino, convertido);
    } catch {
      // Conversão que falha não perde o download: o player tenta o arquivo
      // baixado e, se não tocar, oferece converter de novo.
    }
  }

  async function rodarJanela(): Promise<void> {
    while (janela.length) {
      const item = janela[0];
      const est = janelas.get(item.courseId) ?? { ativo: true, erro: null };
      janelas.set(item.courseId, est);
      const ac = new AbortController();
      atual = { item, ac };
      try {
        if (!arquivoBaixado(db, config, 'aula', item.id)) await baixarItem(item, destinoDe(db, config, item), ac.signal);
        est.erro = null;
        if (janela[0] === item) janela.shift();
      } catch (e) {
        // Abortado: outra aula foi aberta (a janela já é outra) ou mandaram parar.
        if (!ac.signal.aborted) {
          est.erro = motivo(e);
          // Tenta de novo quando a pessoa abrir uma aula.
          janela = janela.filter((i) => i.courseId !== item.courseId);
        } else if (janela[0] === item) janela.shift();
      } finally {
        atual = null;
      }
      if (!janela.some((i) => i.courseId === item.courseId)) est.ativo = false;
    }
  }

  async function baixarCursoInteiro(courseId: string, estado: EstadoDownload, signal: AbortSignal): Promise<void> {
    if (!db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId)) return;
    const itens = itensDoCurso(courseId);
    const faltam = itens.filter((it) => !arquivoBaixado(db, config, it.tipo, it.id));
    const peso = (it: ItemBaixavel) => Math.max(it.tamanho, 0);
    estado.total = itens.length;
    estado.bytesTotal = itens.reduce((s, it) => s + peso(it), 0);
    estado.feitos = itens.length - faltam.length;
    estado.bytesFeitos = estado.bytesTotal - faltam.reduce((s, it) => s + peso(it), 0);

    // Um curso passa fácil de 40 GB: não cabendo, nem começa, em vez de encher o
    // disco e parar no meio.
    const raiz = pastaDeArmazenamento(db, config);
    const livre = (() => {
      try {
        const s = fs.statfsSync(fs.existsSync(raiz) ? raiz : path.dirname(raiz));
        return s.bavail * s.bsize;
      } catch {
        return Infinity;
      }
    })();
    if (estado.bytesTotal - estado.bytesFeitos > livre) throw Object.assign(new Error('sem espaço'), { code: 'ENOSPC' });

    for (let i = 0; i < faltam.length; ) {
      if (signal.aborted) return;
      // A aula que a pessoa abriu passa na frente.
      if (janela.length) {
        await rodarJanela();
        continue;
      }
      const it = faltam[i];
      // A janela pode ter acabado de baixar este.
      if (!arquivoBaixado(db, config, it.tipo, it.id)) {
        const destino = destinoDe(db, config, it);
        const ac = new AbortController();
        const parar = () => ac.abort(PARAR);
        signal.addEventListener('abort', parar);
        atual = { item: it, ac };
        estado.arquivo = path.basename(destino);
        parciais.set(courseId, `${destino}.part`);
        try {
          await baixarItem(it, destino, ac.signal);
        } catch (e) {
          // Interrompido para a aula aberta: volta a este arquivo, do `.part`.
          if (ac.signal.reason === PASSAR_NA_FRENTE && !signal.aborted) continue;
          throw e;
        } finally {
          signal.removeEventListener('abort', parar);
          atual = null;
          parciais.delete(courseId);
        }
      }
      estado.feitos++;
      estado.bytesFeitos += peso(it);
      i++;
    }
    estado.arquivo = null;
  }

  async function rodarCurso(id: string): Promise<void> {
    const estado = estados.get(id);
    if (!estado) return;
    const ac = new AbortController();
    cursoAtual = { id, ac };
    estado.naFila = false;
    const feitosAntes = estado.feitos;
    try {
      await baixarCursoInteiro(id, estado, ac.signal);
      estado.erro = null;
      // Terminou (ou o curso foi excluído no meio): sai da lista de retomar.
      if (!ac.signal.aborted) tirarPendente(id);
    } catch (e) {
      estado.erro = ac.signal.aborted ? null : motivo(e);
    }
    cursoAtual = null;
    parciais.delete(id);
    estado.cancelado = ac.signal.aborted;
    estado.arquivo = null;
    estado.ativo = false;
    // Caiu a rede no meio: tenta de novo sozinho, continuando do `.part`. Se
    // andou alguma coisa desde a última falha, a contagem recomeça.
    const espera = estado.erro ? ESPERA_POR_FALHA[estado.erro] : undefined;
    if (espera) {
      const n = estado.feitos > feitosAntes ? 1 : (tentativas.get(id) ?? 0) + 1;
      tentativas.set(id, n);
      if (n <= MAX_TENTATIVAS) {
        estado.tentarEm = Date.now() + espera;
        religar.set(
          id,
          setTimeout(() => {
            religar.delete(id);
            if (estados.get(id) === estado && !estado.ativo && !estado.cancelado) baixador.baixarCurso(id);
          }, espera),
        );
      }
    } else {
      tentativas.delete(id);
    }
  }

  async function laco(): Promise<void> {
    try {
      for (;;) {
        if (janela.length) {
          await rodarJanela();
          continue;
        }
        const id = fila.shift();
        if (!id) break;
        await rodarCurso(id);
      }
    } finally {
      fontes.clear();
    }
  }

  // Começa no próximo tique: se o laço rodasse já aqui, um pedido feito de dentro
  // dele (antes de `rodando` ser atribuído) abriria um segundo laço em paralelo,
  // e os dois escreveriam o mesmo arquivo. No fim, confere de novo: um pedido
  // entre o laço sair e `rodando` zerar não pode ficar parado.
  function iniciar(): void {
    if (rodando) return;
    rodando = Promise.resolve()
      .then(laco)
      .finally(() => {
        rodando = null;
        if (janela.length || fila.length) iniciar();
      });
  }

  // Uma foto do estado com o progresso dentro do arquivo atual e a velocidade.
  function foto(e: EstadoDownload): EstadoDownload {
    let parcial = 0;
    const p = parciais.get(e.courseId);
    if (e.ativo && p) {
      try {
        parcial = fs.statSync(p).size;
      } catch {
        /* ainda não criado, ou acabou de virar o arquivo final */
      }
    }
    const bytesFeitos = Math.min(e.bytesFeitos + parcial, e.bytesTotal || Infinity);
    let velocidade: number | null = null;
    if (e.ativo && !e.naFila) {
      const agora = Date.now();
      const lista = (amostras.get(e.courseId) ?? []).filter((a) => agora - a.t <= JANELA_MS);
      lista.push({ t: agora, b: bytesFeitos });
      amostras.set(e.courseId, lista);
      const [a, z] = [lista[0], lista[lista.length - 1]];
      if (z.t - a.t >= 1000) velocidade = Math.max(0, ((z.b - a.b) * 1000) / (z.t - a.t));
    } else {
      amostras.delete(e.courseId);
    }
    return { ...e, bytesFeitos, velocidade };
  }

  const pararReligar = (id: string) => {
    clearTimeout(religar.get(id));
    religar.delete(id);
  };

  const baixador: Baixador = {
    pedirAula(lessonId) {
      const aula = db
        .prepare("SELECT l.course_id, l.order_index FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id=? AND c.source IN ('drive','telegram')")
        .get(lessonId) as { course_id: string; order_index: number } | undefined;
      if (!aula || !config.downloadsDir) return;
      // A aberta e as próximas ainda não concluídas: a concluída a pessoa já viu, e
      // baixá-la só ocuparia disco.
      const linhas = db
        .prepare(
          `SELECT l.id, l.rel_path, l.remote_id, l.size_bytes FROM lessons l LEFT JOIN progress p ON p.lesson_id = l.id
           WHERE l.course_id=? AND l.missing=0 AND l.remote_id IS NOT NULL AND l.order_index >= ?
             AND (l.id = ? OR COALESCE(p.completed, 0) = 0)
           ORDER BY l.order_index LIMIT ?`,
        )
        .all(aula.course_id, aula.order_index, lessonId, JANELA + 1) as Linha[];
      janela = linhas.map((l) => itemDe('aula', aula.course_id, l)).filter((it) => !arquivoBaixado(db, config, 'aula', it.id));
      for (const [id, e] of janelas) if (id !== aula.course_id) e.ativo = false;
      if (!janela.length) return;
      janelas.set(aula.course_id, { ativo: true, erro: null });
      // O que está sendo gravado não é o que a pessoa abriu: interrompe (o `.part`
      // fica) e volta a ele depois.
      if (atual && !(atual.item.tipo === 'aula' && atual.item.id === janela[0].id)) atual.ac.abort(PASSAR_NA_FRENTE);
      iniciar();
    },
    janela: (courseId) => janelas.get(courseId) ?? { ativo: false, erro: null },
    baixarCurso(courseId) {
      const curso = db.prepare('SELECT title, source FROM courses WHERE id=?').get(courseId) as { title: string; source: string } | undefined;
      if (!curso || !config.downloadsDir) return tirarPendente(courseId);
      if (estados.get(courseId)?.ativo) return;
      pararReligar(courseId);
      marcarPendente(courseId);
      // Na fila atrás de outros (o "Baixar" da categoria enfileira vários), o
      // total já conta: a barra da categoria soma todos desde o começo.
      const itens = itensDoCurso(courseId);
      // Pedir de novo põe no fim da lista do painel, como um pedido novo.
      estados.delete(courseId);
      estados.set(courseId, {
        courseId,
        titulo: curso.title,
        origem: curso.source === 'telegram' ? 'telegram' : 'drive',
        ativo: true,
        naFila: true,
        cancelado: false,
        arquivo: null,
        velocidade: null,
        feitos: 0,
        total: itens.length,
        bytesFeitos: 0,
        bytesTotal: itens.reduce((s, it) => s + Math.max(it.tamanho, 0), 0),
        erro: null,
        tentarEm: null,
        pasta: pastaDoCurso(db, config, courseId),
      });
      fila.push(courseId);
      iniciar();
    },
    cancelar(courseId) {
      tirarPendente(courseId);
      tentativas.delete(courseId);
      pararReligar(courseId);
      const e = estados.get(courseId);
      if (e && !e.ativo) {
        e.cancelado = true;
        e.tentarEm = null;
      }
      const i = fila.indexOf(courseId);
      if (i >= 0) fila.splice(i, 1);
      if (e && i >= 0) Object.assign(e, { ativo: false, naFila: false, cancelado: true });
      janela = janela.filter((it) => it.courseId !== courseId);
      const j = janelas.get(courseId);
      if (j) j.ativo = false;
      if (cursoAtual?.id === courseId) cursoAtual.ac.abort(PARAR);
      if (atual?.item.courseId === courseId) atual.ac.abort(PARAR);
    },
    async soltar(courseId) {
      while (atual?.item.courseId === courseId || cursoAtual?.id === courseId) await new Promise((r) => setTimeout(r, 50));
    },
    estado: (courseId) => {
      const e = estados.get(courseId);
      return e ? foto(e) : null;
    },
    todos: () => [...estados.values()].map(foto),
    dispensar(courseId) {
      if (estados.get(courseId)?.ativo) return;
      estados.delete(courseId);
      // Tirar da lista é desistir: não volta ao abrir o app nem tenta de novo.
      tirarPendente(courseId);
      pararReligar(courseId);
    },
    retomar() {
      for (const id of lerPendentes()) baixador.baixarCurso(id);
    },
    ocupado: () => [...estados.values()].some((e) => e.ativo || e.tentarEm != null),
    async pararTudo(esquecer) {
      const ids = [...estados.values()].filter((e) => e.ativo || e.tentarEm != null).map((e) => e.courseId);
      for (const id of ids) baixador.cancelar(id);
      for (const id of janelas.keys()) baixador.cancelar(id);
      await baixador.aguardar();
      if (esquecer) for (const id of ids) estados.delete(id);
      return ids;
    },
    async aguardar() {
      while (rodando) await rodando;
    },
  };
  return baixador;
}
