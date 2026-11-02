import type { Db } from '../db';
import { gerarCapa, type DepsCapa, type ResultadoCapa } from './thumbs';

// A fila das capas que ainda não existem no disco. A rota da capa responde na hora
// com o que já está gravado e, se não há nada, só pede aqui: esperar a rede dentro
// da requisição prendia as poucas conexões que a janela abre com o servidor, e uma
// lista de 448 aulas sem capa travava a API e até o vídeo.
//
// A ordem é a pedida por último primeiro: quem rola a lista quer as capas que estão
// na tela agora, não as que passaram. A falha fica em `capas_estado` com a hora de
// tentar de novo; antes, a capa que não existe era pedida ao Drive ou ao Telegram
// a cada vez que a tela aparecia.

export interface FilaCapas {
  pedir(lessonId: string): void;
  /** A rota de stream remoto avisa: a aula está tocando, o ffmpeg das capas espera. */
  videoRemotoTocando(): void;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
/** Origem e ffmpeg responderam sem imagem: espera cada vez mais, até uma semana. */
const ESPERAS_SEM_CAPA = [HORA, 6 * HORA, DIA, 7 * DIA];
const ESPERA_REDE = 5 * MINUTO;
// Sem ffmpeg não adianta tentar até o app abrir com ele (app.ts apaga estas linhas).
const ESPERA_SEM_FFMPEG = 100 * 365 * DIA;
const MAX_PEDIDOS = 500;
/** Capas sendo geradas ao mesmo tempo (os limites por origem ficam em thumbs.ts). */
const TRABALHADORES = 3;
/** Sem stream remoto há este tempo, o ffmpeg das capas pode ler pela rede. */
const SILENCIO_DO_VIDEO = 30_000;

export function podeTentarCapa(db: Db, lessonId: string, agora = Date.now()): boolean {
  const r = db.prepare('SELECT proxima_em FROM capas_estado WHERE lesson_id=?').get(lessonId) as { proxima_em: number } | undefined;
  return !r || r.proxima_em <= agora;
}

export function registrarFalhaDeCapa(db: Db, lessonId: string, motivo: Exclude<ResultadoCapa, 'ok'>, agora = Date.now()): void {
  const r = db.prepare('SELECT tentativas FROM capas_estado WHERE lesson_id=?').get(lessonId) as { tentativas: number } | undefined;
  const antes = r?.tentativas ?? 0;
  // Falha de rede não diz nada sobre a capa existir: não conta tentativa.
  const tentativas = motivo === 'sem-capa' ? antes + 1 : antes;
  const espera =
    motivo === 'rede' ? ESPERA_REDE : motivo === 'sem-ffmpeg' ? ESPERA_SEM_FFMPEG : ESPERAS_SEM_CAPA[Math.min(tentativas, ESPERAS_SEM_CAPA.length) - 1];
  db.prepare(
    `INSERT INTO capas_estado (lesson_id, tentativas, proxima_em, motivo) VALUES (?, ?, ?, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET tentativas=excluded.tentativas, proxima_em=excluded.proxima_em, motivo=excluded.motivo`,
  ).run(lessonId, tentativas, agora + espera, motivo);
}

export function criarFilaCapas(
  deps: Omit<DepsCapa, 'porta' | 'esperarSemVideo'>,
): FilaCapas & { definirPorta(porta: number): void; aguardar(): Promise<void> } {
  const { db } = deps;
  // O fim da lista é o topo: o último pedido sai primeiro.
  let pedidos: string[] = [];
  const emAndamento = new Set<string>();
  let ativos = 0;
  let porta: number | null = null;
  let ultimoVideo = 0;
  let vazia: Array<() => void> = [];

  const esperarSemVideo = async () => {
    while (Date.now() - ultimoVideo < SILENCIO_DO_VIDEO) await new Promise((r) => setTimeout(r, 5000));
  };
  const depsCapa: DepsCapa = { ...deps, porta: () => porta, esperarSemVideo };

  async function gerar(lessonId: string): Promise<void> {
    let r: ResultadoCapa;
    try {
      r = await gerarCapa(depsCapa, lessonId);
    } catch {
      r = 'rede';
    }
    try {
      if (r === 'ok') db.prepare('DELETE FROM capas_estado WHERE lesson_id=?').run(lessonId);
      else registrarFalhaDeCapa(db, lessonId, r);
    } catch {
      // A aula foi apagada no meio (curso excluído): a chave estrangeira recusa a linha.
    }
  }

  function bombear(): void {
    while (ativos < TRABALHADORES && pedidos.length) {
      const id = pedidos.pop()!;
      emAndamento.add(id);
      ativos++;
      void gerar(id).finally(() => {
        ativos--;
        emAndamento.delete(id);
        bombear();
        if (!ativos && !pedidos.length) {
          for (const f of vazia) f();
          vazia = [];
        }
      });
    }
  }

  return {
    pedir(lessonId) {
      if (emAndamento.has(lessonId) || !podeTentarCapa(db, lessonId)) return;
      // Pedida de novo: sobe para o topo em vez de entrar duas vezes.
      pedidos = pedidos.filter((id) => id !== lessonId);
      pedidos.push(lessonId);
      // As mais antigas saem; voltam quando a tela pedir de novo.
      if (pedidos.length > MAX_PEDIDOS) pedidos.splice(0, pedidos.length - MAX_PEDIDOS);
      bombear();
    },
    videoRemotoTocando() {
      ultimoVideo = Date.now();
    },
    definirPorta(p) {
      porta = p;
    },
    aguardar: () => (ativos || pedidos.length ? new Promise<void>((r) => vazia.push(r)) : Promise.resolve()),
  };
}
