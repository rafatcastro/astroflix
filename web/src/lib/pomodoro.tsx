import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { getPref, setPref } from './prefs';

// O pomodoro roda aqui, na interface: é aqui que estão o vídeo (que para na pausa)
// e o PDF. O estado guarda a HORA em que a fase acaba, não um contador: recarregar
// a janela não perde o timer. Ao servidor só vai o foco concluído (painel de estudo).

export type Fase = 'foco' | 'pausa' | 'pausa-longa';

export interface ConfigPomodoro {
  foco: number;
  pausa: number;
  pausaLonga: number;
  /** Pausa longa depois de quantos focos. */
  aCada: number;
}

export const CONFIG_PADRAO: ConfigPomodoro = { foco: 25, pausa: 5, pausaLonga: 15, aCada: 4 };
const CHAVE_CONFIG = 'pomodoro.config';
const CHAVE_ESTADO = 'pomodoro.estado';

export function lerConfig(): ConfigPomodoro {
  return { ...CONFIG_PADRAO, ...getPref<Partial<ConfigPomodoro>>(CHAVE_CONFIG, {}) };
}
export function salvarConfig(c: ConfigPomodoro): void {
  setPref(CHAVE_CONFIG, c);
}

interface Estado {
  fase: Fase;
  categoriaId: string | null;
  /** Quando a fase acaba (ms); null enquanto pausado ou esperando a pessoa começar o foco. */
  terminaEm: number | null;
  /** O que faltava quando a pessoa pausou. */
  restantePausado: number | null;
  /** A pausa acabou: o próximo foco só começa quando a pessoa pedir. */
  aguardandoFoco: boolean;
  focosNoCiclo: number;
  inicioFoco: number | null;
  /** Fechado pela pessoa: o timer continua; só os avisos aparecem. */
  oculto: boolean;
}

export interface Aviso {
  texto: string;
  acao?: { rotulo: string; fazer: () => void };
}

interface Pomodoro {
  estado: Estado | null;
  restanteMs: number;
  /** Na pausa (curta ou longa): o vídeo fica parado até a pausa acabar ou ser pulada. */
  emPausa: boolean;
  iniciar(categoriaId: string | null): void;
  pausar(): void;
  retomar(): void;
  pular(): void;
  parar(): void;
  comecarFoco(): void;
  ocultar(): void;
  mostrar(): void;
  aviso: Aviso | null;
  fecharAviso(): void;
}

const Ctx = createContext<Pomodoro | null>(null);

function lerEstado(): Estado | null {
  return getPref<Estado | null>(CHAVE_ESTADO, null);
}

// Um "plim" curto, sem arquivo de áudio.
function tocar() {
  try {
    const ac = new AudioContext();
    for (const [i, f] of [880, 1320].entries()) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.18 + 0.5);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.18);
      o.stop(ac.currentTime + i * 0.18 + 0.55);
    }
    window.setTimeout(() => void ac.close(), 1500);
  } catch {
    /* sem áudio: o aviso na tela basta */
  }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [estado, setEstadoBruto] = useState<Estado | null>(lerEstado);
  const [agora, setAgora] = useState(Date.now());
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  const setEstado = useCallback((e: Estado | null) => {
    estadoRef.current = e;
    setEstadoBruto(e);
    setPref(CHAVE_ESTADO, e);
  }, []);

  const comecarFoco = useCallback(() => {
    const e = estadoRef.current;
    if (!e) return;
    const t = Date.now();
    setEstado({ ...e, fase: 'foco', aguardandoFoco: false, terminaEm: t + lerConfig().foco * 60_000, restantePausado: null, inicioFoco: t });
    setAviso(null);
  }, [setEstado]);

  // Vira de fase: foco concluído vai para o painel e começa a pausa; a pausa
  // acabada espera a pessoa (começar o foco sozinho pegaria ela desprevenida).
  const virar = useCallback(
    (concluiuFoco: boolean) => {
      const e = estadoRef.current;
      if (!e) return;
      const cfg = lerConfig();
      const t = Date.now();
      if (e.fase === 'foco') {
        if (concluiuFoco) {
          void api
            .registrarPomodoro({
              categoriaId: e.categoriaId,
              inicio: new Date(e.inicioFoco ?? t - cfg.foco * 60_000).toISOString(),
              fim: new Date(t).toISOString(),
              minutos: cfg.foco,
            })
            .then(() => qc.invalidateQueries({ queryKey: ['estudo'] }), () => undefined);
        }
        const focos = e.focosNoCiclo + 1;
        const longa = focos % cfg.aCada === 0;
        setEstado({
          ...e,
          fase: longa ? 'pausa-longa' : 'pausa',
          focosNoCiclo: focos,
          terminaEm: t + (longa ? cfg.pausaLonga : cfg.pausa) * 60_000,
          restantePausado: null,
          aguardandoFoco: false,
          inicioFoco: null,
        });
        if (concluiuFoco) {
          tocar();
          setAviso({ texto: `Hora da pausa: ${longa ? cfg.pausaLonga : cfg.pausa} minutos. O vídeo fica parado até ela acabar.` });
        }
      } else {
        setEstado({ ...e, fase: 'foco', terminaEm: null, restantePausado: null, aguardandoFoco: true, inicioFoco: null });
        if (concluiuFoco) tocar();
        setAviso({ texto: 'A pausa acabou.', acao: { rotulo: 'Começar foco', fazer: comecarFoco } });
      }
    },
    [comecarFoco, qc, setEstado],
  );

  useEffect(() => {
    if (!estado?.terminaEm) return;
    const i = window.setInterval(() => {
      const t = Date.now();
      setAgora(t);
      const e = estadoRef.current;
      if (e?.terminaEm && t >= e.terminaEm) virar(true);
    }, 500);
    return () => window.clearInterval(i);
  }, [estado?.terminaEm, virar]);

  const valor: Pomodoro = {
    estado,
    restanteMs: estado ? (estado.terminaEm ? Math.max(0, estado.terminaEm - agora) : (estado.restantePausado ?? lerConfig().foco * 60_000)) : 0,
    emPausa: !!estado && estado.fase !== 'foco',
    iniciar(categoriaId) {
      const t = Date.now();
      setAgora(t);
      setEstado({
        fase: 'foco',
        categoriaId,
        terminaEm: t + lerConfig().foco * 60_000,
        restantePausado: null,
        aguardandoFoco: false,
        focosNoCiclo: 0,
        inicioFoco: t,
        oculto: false,
      });
      setAviso(null);
    },
    pausar() {
      const e = estadoRef.current;
      if (!e?.terminaEm) return;
      setEstado({ ...e, restantePausado: Math.max(0, e.terminaEm - Date.now()), terminaEm: null });
    },
    retomar() {
      const e = estadoRef.current;
      if (!e || e.restantePausado == null) return;
      const t = Date.now();
      setAgora(t);
      setEstado({ ...e, terminaEm: t + e.restantePausado, restantePausado: null });
    },
    // Pular o foco não conta como concluído; pular a pausa vai direto para o foco.
    pular() {
      const e = estadoRef.current;
      if (!e) return;
      if (e.fase === 'foco') {
        if (e.aguardandoFoco) comecarFoco();
        else virar(false);
      } else comecarFoco();
    },
    parar() {
      setEstado(null);
      setAviso(null);
    },
    comecarFoco,
    ocultar() {
      const e = estadoRef.current;
      if (e) setEstado({ ...e, oculto: true });
    },
    mostrar() {
      const e = estadoRef.current;
      if (e) setEstado({ ...e, oculto: false });
    },
    aviso,
    fecharAviso: () => setAviso(null),
  };

  return (
    <Ctx.Provider value={valor}>
      {children}
      {aviso && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-4 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 shadow-lg shadow-black/50"
        >
          <span aria-hidden>🍅</span>
          <span className="min-w-0 flex-1">{aviso.texto}</span>
          {aviso.acao && (
            <button
              type="button"
              onClick={aviso.acao.fazer}
              className="min-h-[36px] shrink-0 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-500"
            >
              {aviso.acao.rotulo}
            </button>
          )}
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" className="shrink-0 px-1 text-neutral-400 hover:text-neutral-200">
            ✕
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function usePomodoro(): Pomodoro {
  const p = useContext(Ctx);
  if (!p) throw new Error('usePomodoro fora do PomodoroProvider');
  return p;
}

export function formatarRelogio(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 1h20, 45 min, 0 min. */
export function formatarDuracao(segundos: number): string {
  const min = Math.floor(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
