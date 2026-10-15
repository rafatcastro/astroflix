import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PeriodoEstudo } from '../api/client';
import { useCollections } from '../api/hooks';
import { formatarDuracao, formatarRelogio, usePomodoro, type Fase } from '../lib/pomodoro';

const NOME_FASE: Record<Fase, string> = { foco: 'Foco', pausa: 'Pausa', 'pausa-longa': 'Pausa longa' };

const botao =
  'min-h-[36px] rounded-lg px-2.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

function useNomeDaCategoria(id: string | null): string {
  const { data } = useCollections();
  if (!id) return 'Sem categoria';
  const c = data?.find((x) => x.id === id);
  return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : '';
}

/** Os controles do timer em andamento. `fechar`: a pessoa pode tirar da tela (o timer segue). */
function Controles({ fechar }: { fechar: boolean }) {
  const p = usePomodoro();
  const e = p.estado!;
  const pausado = e.restantePausado != null;
  return (
    <div className="flex items-center gap-1">
      {e.aguardandoFoco ? (
        <button type="button" onClick={p.comecarFoco} className="min-h-[36px] rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-500">
          Começar foco
        </button>
      ) : (
        <>
          <button type="button" onClick={pausado ? p.retomar : p.pausar} className={botao}>
            {pausado ? 'Retomar' : 'Pausar'}
          </button>
          <button type="button" onClick={p.pular} className={botao}>
            {e.fase === 'foco' ? 'Pular' : 'Pular pausa'}
          </button>
        </>
      )}
      <button type="button" onClick={p.parar} className={`${botao} hover:text-red-400`}>
        Parar
      </button>
      {fechar && (
        <button type="button" onClick={p.ocultar} aria-label="Fechar o timer (ele continua contando)" title="Fechar (o timer continua)" className={botao}>
          ✕
        </button>
      )}
    </div>
  );
}

function Mostrador() {
  const p = usePomodoro();
  const e = p.estado!;
  const nome = useNomeDaCategoria(e.categoriaId);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="text-lg">🍅</span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-medium ${e.fase === 'foco' ? 'text-neutral-100' : 'text-green-400'}`}>
            {e.aguardandoFoco ? 'Pausa acabou' : NOME_FASE[e.fase]}
          </span>
          {!e.aguardandoFoco && (
            <span className="font-mono text-lg tabular-nums text-neutral-50" aria-label="Tempo restante">
              {formatarRelogio(p.restanteMs)}
            </span>
          )}
          {e.restantePausado != null && <span className="text-xs text-neutral-500">pausado</span>}
        </div>
        <div className="truncate text-xs text-neutral-500">{nome}</div>
      </div>
    </div>
  );
}

/**
 * O timer nas telas de estudo: `barra` embaixo do vídeo, `flutuante` no canto (PDF).
 * Fechado pela pessoa, some: só os avisos de pausa aparecem.
 */
export function WidgetPomodoro({ variante }: { variante: 'barra' | 'flutuante' }) {
  const p = usePomodoro();
  if (!p.estado || p.estado.oculto) return null;
  if (variante === 'barra') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 bg-neutral-950 px-4 py-2">
        <Mostrador />
        <Controles fechar />
      </div>
    );
  }
  return (
    <div className="fixed bottom-4 right-4 z-30 flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/95 p-3 shadow-lg shadow-black/50">
      <Mostrador />
      <Controles fechar />
    </div>
  );
}

/** Por cima do vídeo durante a pausa: ele não toca até a pausa acabar ou ser pulada. */
export function BloqueioDaPausa() {
  const p = usePomodoro();
  if (!p.emPausa || !p.estado) return null;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/80 text-center">
      <div>
        <div className="text-sm text-green-400">{NOME_FASE[p.estado.fase]}</div>
        <div className="mt-1 font-mono text-5xl tabular-nums text-white">{formatarRelogio(p.restanteMs)}</div>
        <p className="mt-2 text-sm text-neutral-400">Levante, beba água. O vídeo volta quando a pausa acabar.</p>
        <button type="button" onClick={p.pular} className="mt-4 min-h-[44px] rounded-lg bg-neutral-800 px-4 text-sm text-neutral-100 hover:bg-neutral-700">
          Pular pausa
        </button>
      </div>
    </div>
  );
}

function EscolherCategoria({ onFechar }: { onFechar: () => void }) {
  const p = usePomodoro();
  const { data: cats } = useCollections();
  const opcao = 'flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';
  const iniciar = (id: string | null) => {
    p.iniciar(id);
    onFechar();
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Focar em qual categoria?"
        className="w-full max-w-sm rounded-xl bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onFechar()}
      >
        <h2 className="px-1 font-medium text-neutral-100">Focar em qual categoria?</h2>
        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {(cats ?? []).map((c, i) => (
            <button key={c.id} type="button" autoFocus={i === 0} className={opcao} onClick={() => iniciar(c.id)}>
              <span className="w-6 text-center text-lg" aria-hidden>
                {c.emoji ?? '•'}
              </span>
              {c.name}
            </button>
          ))}
          <button type="button" autoFocus={!cats?.length} className={`${opcao} text-neutral-400`} onClick={() => iniciar(null)}>
            <span className="w-6" aria-hidden />
            Sem categoria
          </button>
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, p }: { rotulo: string; p: PeriodoEstudo | undefined }) {
  return (
    <div className="rounded-xl bg-neutral-900 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{rotulo}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-50">
        🍅 {p?.pomodoros ?? '–'}
      </div>
      <div className="text-sm tabular-nums text-neutral-400">{p ? `${formatarDuracao(p.segundosAula)} de aula` : ' '}</div>
    </div>
  );
}

/** O painel da tela principal: pomodoros e tempo de aula, e o timer quando há um. */
export function PainelEstudo() {
  const p = usePomodoro();
  const { data } = useQuery({ queryKey: ['estudo'], queryFn: api.estudoResumo, refetchInterval: 60_000 });
  const [escolhendo, setEscolhendo] = useState(false);
  return (
    <section aria-label="Estudo" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-300">Estudo</h2>
        {!p.estado && (
          <button
            type="button"
            onClick={() => setEscolhendo(true)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-neutral-800 px-3 text-sm text-neutral-100 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            🍅 Iniciar pomodoro
          </button>
        )}
      </div>
      {p.estado && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-2">
          <Mostrador />
          <Controles fechar={false} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Hoje" p={data?.hoje} />
        <Numero rotulo="Semana" p={data?.semana} />
        <Numero rotulo="Mês" p={data?.mes} />
        <Numero rotulo="Total" p={data?.total} />
      </div>
      {escolhendo && <EscolherCategoria onFechar={() => setEscolhendo(false)} />}
    </section>
  );
}

/** "🍅 3 · 1h20 hoje" no cartão da categoria; nada se não estudou hoje. */
export function EstudoDeHoje({ categoriaId }: { categoriaId: string }) {
  const { data } = useQuery({ queryKey: ['estudo'], queryFn: api.estudoResumo, refetchInterval: 60_000 });
  const h = data?.porCategoria[categoriaId];
  if (!h || (!h.pomodoros && h.segundosAula < 60)) return null;
  const partes = [h.pomodoros ? `🍅 ${h.pomodoros}` : null, h.segundosAula >= 60 ? formatarDuracao(h.segundosAula) : null].filter(Boolean);
  return <div className="mt-1 text-xs text-green-400/90">{partes.join(' · ')} hoje</div>;
}
