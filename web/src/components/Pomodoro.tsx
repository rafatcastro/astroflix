import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type NumerosEstudo, type PeriodoEstudo } from '../api/client';
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

type Periodo = 'hoje' | 'semana' | 'mes' | 'total';
const PERIODOS: { chave: Periodo; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: 'semana', rotulo: 'Semana' },
  { chave: 'mes', rotulo: 'Mês' },
  { chave: 'total', rotulo: 'Total' },
];
type Medida = 'aula' | 'pomodoros';

// Paleta categórica (passo escuro), validada no fundo #171717. A cor segue a
// categoria pela ordem do menu, não pelo tamanho da fatia: mudar de período não
// repinta ninguém. Da 6ª em diante vira "Outras"; "Sem categoria" é cinza.
const CORES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const COR_SEM = '#8a8a86';
const COR_OUTRAS = '#5c5c59';
const SUPERFICIE = '#171717';

interface Fatia {
  id: string;
  nome: string;
  cor: string;
  valor: number;
}

function valorDe(n: NumerosEstudo | undefined, m: Medida): number {
  return !n ? 0 : m === 'aula' ? n.segundosAula : n.pomodoros;
}
const rotuloValor = (v: number, m: Medida) => (m === 'aula' ? formatarDuracao(v) : `${v} 🍅`);

function useFatias(periodo: PeriodoEstudo | undefined, medida: Medida): Fatia[] {
  const { data: cats } = useCollections();
  if (!periodo) return [];
  const fatias: Fatia[] = [];
  let outras = 0;
  // A ordem do menu muda com a última aberta; a cor precisa ser estável, então a
  // vaga de cor sai da ordem alfabética, que só muda quando a pessoa renomeia.
  const ordem = [...(cats ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  ordem.forEach((c, i) => {
    const v = valorDe(periodo.porCategoria[c.id], medida);
    if (!v) return;
    if (i < CORES.length) fatias.push({ id: c.id, nome: `${c.emoji ? `${c.emoji} ` : ''}${c.name}`, cor: CORES[i], valor: v });
    else outras += v;
  });
  const sem = valorDe(periodo.porCategoria.sem, medida);
  if (sem) fatias.push({ id: 'sem', nome: 'Sem categoria', cor: COR_SEM, valor: sem });
  // Categoria apagada depois de estudada: o número dela continua no total.
  const conhecidas = new Set([...(cats ?? []).map((c) => c.id), 'sem']);
  for (const [id, n] of Object.entries(periodo.porCategoria)) if (!conhecidas.has(id)) outras += valorDe(n, medida);
  if (outras) fatias.push({ id: 'outras', nome: 'Outras', cor: COR_OUTRAS, valor: outras });
  return fatias;
}

function arco(cx: number, cy: number, r: number, de: number, ate: number): string {
  const ponto = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = ponto(de);
  const [x1, y1] = ponto(ate);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${ate - de > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

/** Rosca: a fatia é a parte de cada categoria no período. A legenda ao lado leva nome e valor. */
function Pizza({ fatias, medida }: { fatias: Fatia[]; medida: Medida }) {
  const [foco, setFoco] = useState<string | null>(null);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const T = 132;
  const c = T / 2;
  const r = 52;
  const espessura = 20;
  let ang = 0;
  const atual = fatias.find((f) => f.id === foco);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={T} height={T} viewBox={`0 0 ${T} ${T}`} role="img" aria-label="Divisão por categoria" className="shrink-0">
        {fatias.length === 1 ? (
          <circle cx={c} cy={c} r={r} fill="none" stroke={fatias[0].cor} strokeWidth={espessura} />
        ) : (
          fatias.map((f) => {
            const de = ang;
            ang += (f.valor / total) * Math.PI * 2;
            return (
              <path
                key={f.id}
                d={arco(c, c, r, de, ang)}
                fill="none"
                stroke={f.cor}
                strokeWidth={foco === f.id ? espessura + 4 : espessura}
                onMouseEnter={() => setFoco(f.id)}
                onMouseLeave={() => setFoco(null)}
                style={{ transition: 'stroke-width 120ms' }}
              />
            );
          })
        )}
        {/* O vão de 2px entre as fatias: linhas da cor do fundo nas divisas. */}
        {fatias.length > 1 &&
          (() => {
            let a = 0;
            return fatias.map((f) => {
              const x = c + (r + espessura) * Math.sin(a);
              const y = c - (r + espessura) * Math.cos(a);
              const x0 = c + (r - espessura) * Math.sin(a);
              const y0 = c - (r - espessura) * Math.cos(a);
              a += (f.valor / total) * Math.PI * 2;
              return <line key={f.id} x1={x0} y1={y0} x2={x} y2={y} stroke={SUPERFICIE} strokeWidth={2} pointerEvents="none" />;
            });
          })()}
        <text x={c} y={c - 2} textAnchor="middle" className="fill-neutral-50 text-[13px] font-semibold">
          {atual ? `${Math.round((atual.valor / total) * 100)}%` : medida === 'aula' ? formatarDuracao(total) : total}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" className="fill-neutral-500 text-[10px]">
          {atual ? '' : medida === 'aula' ? 'de aula' : 'pomodoros'}
        </text>
      </svg>
      <ul className="min-w-0 max-w-sm flex-1 space-y-1.5 text-sm">
        {fatias.map((f) => (
          <li
            key={f.id}
            className={`flex items-center gap-2 rounded px-1 ${foco === f.id ? 'bg-neutral-800' : ''}`}
            onMouseEnter={() => setFoco(f.id)}
            onMouseLeave={() => setFoco(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: f.cor }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-neutral-200">{f.nome}</span>
            <span className="shrink-0 tabular-nums text-neutral-400">{rotuloValor(f.valor, medida)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-neutral-500">{Math.round((f.valor / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Segmentos<T extends string>({ opcoes, valor, onMudar, rotulo }: { opcoes: { chave: T; rotulo: string }[]; valor: T; onMudar: (v: T) => void; rotulo: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex rounded-lg bg-neutral-900 p-0.5 text-sm">
      {opcoes.map((o) => (
        <button
          key={o.chave}
          type="button"
          role="radio"
          aria-checked={valor === o.chave}
          onClick={() => onMudar(o.chave)}
          className={`min-h-[34px] rounded-md px-3 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
            valor === o.chave ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Pomodoros do período numa barra só, dividida por categoria (mesmas cores da pizza). */
function BarraPomodoros({ fatias }: { fatias: Fatia[] }) {
  const [foco, setFoco] = useState<string | null>(null);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  return (
    <div>
      <div className="flex h-5 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label="Pomodoros por categoria">
        {fatias.map((f) => (
          <div
            key={f.id}
            title={`${f.nome}: ${f.valor}`}
            onMouseEnter={() => setFoco(f.id)}
            onMouseLeave={() => setFoco(null)}
            className="h-full first:rounded-l last:rounded-r transition-opacity motion-reduce:transition-none"
            style={{ width: `${(f.valor / total) * 100}%`, background: f.cor, opacity: foco && foco !== f.id ? 0.45 : 1 }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {fatias.map((f) => (
          <li key={f.id} className="flex items-center gap-2" onMouseEnter={() => setFoco(f.id)} onMouseLeave={() => setFoco(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: f.cor }} aria-hidden />
            <span className="text-neutral-200">{f.nome}</span>
            <span className="tabular-nums text-neutral-400">{f.valor}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O painel da tela principal: um período por vez, as aulas (pizza) e os pomodoros (barra) por categoria. */
export function PainelEstudo() {
  const p = usePomodoro();
  const { data } = useQuery({ queryKey: ['estudo'], queryFn: api.estudoResumo, refetchInterval: 60_000 });
  const [escolhendo, setEscolhendo] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const atual = data?.[periodo];
  const aulas = useFatias(atual, 'aula');
  const pomodoros = useFatias(atual, 'pomodoros');
  const vazioNoPeriodo: Record<Periodo, string> = { hoje: 'hoje', semana: 'nesta semana', mes: 'neste mês', total: 'ainda' };
  const titulo = 'mb-3 flex items-baseline justify-between gap-3';
  return (
    <section aria-label="Estudo" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-300">Estudo</h2>
          <Segmentos rotulo="Período" opcoes={PERIODOS} valor={periodo} onMudar={setPeriodo} />
        </div>
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
      <div className="grid gap-6 rounded-xl bg-neutral-900 p-5 md:grid-cols-2">
        <div className="min-w-0">
          <div className={titulo}>
            <h3 className="text-sm font-medium text-neutral-200">Aulas assistidas</h3>
            <span className="text-sm tabular-nums text-neutral-400">{atual ? formatarDuracao(atual.segundosAula) : '–'}</span>
          </div>
          {atual && !aulas.length ? (
            <p className="py-6 text-sm text-neutral-500">Nenhuma aula assistida {vazioNoPeriodo[periodo]}.</p>
          ) : (
            <Pizza fatias={aulas} medida="aula" />
          )}
        </div>
        <div className="min-w-0 border-neutral-800 md:border-l md:pl-6">
          <div className={titulo}>
            <h3 className="text-sm font-medium text-neutral-200">Pomodoros</h3>
            <span className="text-sm tabular-nums text-neutral-400">{atual?.pomodoros ?? '–'}</span>
          </div>
          {atual && !pomodoros.length ? (
            <p className="py-6 text-sm text-neutral-500">Nenhum pomodoro concluído {vazioNoPeriodo[periodo]}.</p>
          ) : (
            <BarraPomodoros fatias={pomodoros} />
          )}
        </div>
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
