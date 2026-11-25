import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// A aula que está (ou estava por último) no player, para a barra de baixo que aparece
// em todas as telas (BarraTocando.tsx). O player publica aqui; a barra lê. Fica no
// localStorage: abrir o app de novo mostra a aula em que a pessoa parou.

export interface AulaTocando {
  id: string;
  titulo: string;
  curso: string;
  cursoId: string;
  modulo: string | null;
  posicaoSec: number;
  duracaoSec: number | null;
  tocando: boolean;
}

interface Controles {
  alternar(): void;
}

interface Contexto {
  aula: AulaTocando | null;
  /** O player atualiza o que mudou (posição, tocando…). */
  publicar(a: AulaTocando): void;
  /** Só o player montado registra: a barra toca e pausa por ele. null ao desmontar. */
  registrarControles(c: Controles | null): void;
  alternar(): boolean;
  fechar(): void;
}

const CHAVE = 'tocando.aula';
const Ctx = createContext<Contexto | null>(null);

function lerGuardada(): AulaTocando | null {
  try {
    const a = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as AulaTocando | null;
    // Ninguém está tocando ao abrir o app.
    return a ? { ...a, tocando: false } : null;
  } catch {
    return null;
  }
}

export function TocandoProvider({ children }: { children: ReactNode }) {
  const [aula, setAula] = useState<AulaTocando | null>(lerGuardada);
  const controles = useRef<Controles | null>(null);
  const ultimaGravacao = useRef(0);

  const publicar = useCallback((a: AulaTocando) => {
    setAula((antes) => {
      if (
        antes &&
        antes.id === a.id &&
        antes.tocando === a.tocando &&
        Math.floor(antes.posicaoSec) === Math.floor(a.posicaoSec) &&
        antes.duracaoSec === a.duracaoSec &&
        antes.titulo === a.titulo
      )
        return antes;
      return a;
    });
  }, []);

  // Grava no máximo a cada 5 s: o timeupdate vem várias vezes por segundo.
  useEffect(() => {
    if (!aula) return;
    const agora = Date.now();
    if (agora - ultimaGravacao.current < 5000 && aula.tocando) return;
    ultimaGravacao.current = agora;
    localStorage.setItem(CHAVE, JSON.stringify(aula));
  }, [aula]);

  // Estáveis: o player registra num efeito, e uma função nova a cada segundo o faria
  // se desregistrar (e marcar "parou") o tempo todo.
  const registrarControles = useCallback((c: Controles | null) => {
    controles.current = c;
    // O player saiu da tela: o vídeo dele parou junto.
    if (!c) setAula((a) => (a && a.tocando ? { ...a, tocando: false } : a));
  }, []);
  const alternar = useCallback(() => {
    if (!controles.current) return false;
    controles.current.alternar();
    return true;
  }, []);
  const fechar = useCallback(() => {
    localStorage.removeItem(CHAVE);
    setAula(null);
  }, []);

  const valor = useMemo<Contexto>(
    () => ({ aula, publicar, registrarControles, alternar, fechar }),
    [aula, publicar, registrarControles, alternar, fechar],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useTocando(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTocando fora do TocandoProvider');
  return c;
}
