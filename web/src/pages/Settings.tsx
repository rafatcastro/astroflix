import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cliqueFora, escolherPasta } from '../lib/desktop';
import { api, type Collection } from '../api/client';
import { useCollections, useConexaoDrive } from '../api/hooks';
import { CONFIG_PADRAO, lerConfig, salvarConfig, type ConfigPomodoro } from '../lib/pomodoro';
import { getPref, setPref } from '../lib/prefs';
import { formatBytes } from '../lib/format';
import TelegramLinkModal from '../components/TelegramLinkModal';
import TextField from '../components/TextField';
import ConfirmDialog from '../components/ConfirmDialog';
import Banner from '../components/Banner';
import PainelDownloads from '../components/PainelDownloads';
import { ArrowLeft } from '../components/icons';

const plural = (n: number) => (n === 1 ? '' : 's');



// O Anki só é tocado aqui quando a seção aparece, e só na própria máquina
// (AnkiConnect escuta em localhost). Os flashcards funcionam sem ele: o card fica
// guardado e vai quando o Anki abrir.
const ERRO_NUVEM: Record<string, string> = {
  'sem-conexao': 'Sem internet: as alterações esperam e sobem quando a conexão voltar.',
  'sessao-expirada': 'A sessão expirou. Entre de novo para continuar sincronizando.',
  recusado: 'A nuvem recusou uma alteração. Tente sincronizar de novo.',
};

// Conta e nuvem: quem está usando, quando sincronizou e o que ainda falta subir.

// Os tempos valem a partir da próxima fase: a que está correndo termina como começou.
const CAMPOS_POMODORO: { chave: keyof ConfigPomodoro; rotulo: string; min: number; max: number }[] = [
  { chave: 'foco', rotulo: 'Foco (minutos)', min: 1, max: 240 },
  { chave: 'pausa', rotulo: 'Pausa (minutos)', min: 1, max: 60 },
  { chave: 'pausaLonga', rotulo: 'Pausa longa (minutos)', min: 1, max: 120 },
  { chave: 'aCada', rotulo: 'Pausa longa a cada (focos)', min: 1, max: 12 },
];

function SecaoPomodoro() {
  const [cfg, setCfg] = useState<ConfigPomodoro>(lerConfig);
  const mudar = (chave: keyof ConfigPomodoro, v: number, min: number, max: number) => {
    const n = { ...cfg, [chave]: Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : CONFIG_PADRAO[chave] };
    setCfg(n);
    salvarConfig(n);
  };
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold text-neutral-300">Pomodoro</h2>
      <p className="mb-3 text-sm text-neutral-500">Inicie pela tela principal. Na pausa, o vídeo fica parado até ela acabar ou ser pulada.</p>
      <div className="space-y-2">
        {CAMPOS_POMODORO.map((c) => (
          <label key={c.chave} className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
            {c.rotulo}
            <TextField
              type="number"
              min={c.min}
              max={c.max}
              value={cfg[c.chave]}
              onChange={(e) => mudar(c.chave, Number(e.target.value), c.min, c.max)}
              className="w-20 text-right"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function SecaoConta() {
  const qc = useQueryClient();
  const { data: conta } = useQuery({ queryKey: ['conta'], queryFn: api.conta, refetchInterval: 15_000 });
  const [ocupado, setOcupado] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  if (!conta?.configurada || !conta.entrou) return null;
  const n = conta.nuvem;

  const sincronizar = async () => {
    setOcupado(true);
    await api.contaSincronizar().catch(() => {});
    await qc.invalidateQueries();
    setOcupado(false);
  };
  const sair = async () => {
    setOcupado(true);
    await api.contaSair().catch(() => {});
    // Nada da conta pode ficar na memória da tela para a próxima pessoa.
    qc.clear();
    await qc.invalidateQueries({ queryKey: ['conta'] });
  };
  const quando = n?.ultimaSincronizacao
    ? new Date(n.ultimaSincronizacao).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">Conta</h2>
      <div className="space-y-1 rounded-lg bg-neutral-900 px-3 py-3 text-sm">
        <div className="text-neutral-100">{conta.email ?? 'Conta Google'}</div>
        <div className="text-neutral-400">
          {n?.sincronizando ? 'Sincronizando…' : quando ? `Sincronizado em ${quando}` : 'Ainda não sincronizou nesta abertura'}
          {n && n.pendentes > 0 ? ` · ${n.pendentes} alteração${n.pendentes === 1 ? '' : 'ões'} esperando` : ''}
        </div>
        {n?.erro && <div className="text-amber-200">{ERRO_NUVEM[n.erro]}</div>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void sincronizar()}
          disabled={ocupado}
          className="min-h-[44px] rounded-lg bg-neutral-800 px-3 text-sm text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
        >
          Sincronizar agora
        </button>
        <button
          type="button"
          onClick={() => setConfirmarSaida(true)}
          disabled={ocupado}
          className="min-h-[44px] rounded-lg px-3 text-sm text-neutral-400 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
        >
          Sair
        </button>
      </div>
      {confirmarSaida && (
        <ConfirmDialog
          title="Sair da conta?"
          message="Suas alterações sobem para a nuvem antes. Para voltar a usar o app, é preciso entrar de novo."
          confirmLabel="Sair"
          onConfirm={() => void sair()}
          onCancel={() => setConfirmarSaida(false)}
        />
      )}
    </section>
  );
}

function SecaoAnki() {
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const { data, refetch, isFetching } = useQuery({ queryKey: ['ankiStatus'], queryFn: api.ankiStatus, refetchOnWindowFocus: true });
  // Vindo do aviso "Como conectar" (/settings#anki): leva direto para cá.
  useEffect(() => {
    if (hash === '#anki') ref.current?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const estado = !data
    ? 'Verificando…'
    : data.estado === 'conectado'
      ? 'Conectado ao Anki'
      : data.estado === 'fechado'
        ? 'O Anki não respondeu (fechado ou sem o AnkiConnect)'
        : 'O Anki respondeu com erro';
  return (
    <section id="anki" ref={ref} className="mb-8 scroll-mt-6">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">Anki</h2>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 px-3 py-2 text-sm">
        <span className={data?.estado === 'conectado' ? 'text-green-400' : 'text-neutral-300'}>
          {estado}
          {data && data.pendentes > 0 ? ` · ${data.pendentes} card${plural(data.pendentes)} esperando` : ''}
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="min-h-[44px] shrink-0 rounded px-3 text-neutral-400 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
        >
          Testar de novo
        </button>
      </div>
      <details className="mt-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm" open={data?.estado === 'fechado'}>
        <summary className="min-h-[44px] cursor-pointer py-2 text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          Como conectar
        </summary>
        <ol className="list-decimal space-y-1.5 pb-2 pl-5 text-neutral-400">
          <li>
            Instale o{' '}
            <a href="https://apps.ankiweb.net" onClick={(e) => cliqueFora(e, 'https://apps.ankiweb.net')} className="underline hover:text-neutral-200">
              Anki
            </a>{' '}
            no computador e entre na sua conta do AnkiWeb (Sincronizar).
          </li>
          <li>
            No Anki, vá em <strong className="text-neutral-300">Ferramentas → Complementos → Obter complementos</strong> e cole o código{' '}
            <code className="text-neutral-200">2055492159</code> (AnkiConnect). Reinicie o Anki.
          </li>
          <li>Deixe o Anki aberto enquanto estuda. Os cards entram no baralho Astroflix::Cursos e sincronizam com o AnkiWeb.</li>
        </ol>
      </details>
    </section>
  );
}

function SecaoDrive({ onNotice }: { onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['driveStatus'], queryFn: api.driveStatus });
  const conexao = useConexaoDrive();

  const desconectar = async () => {
    try {
      await api.driveDesconectar();
      qc.invalidateQueries({ queryKey: ['driveStatus'] });
      onNotice('Conta do Google desconectada.');
    } catch {
      onNotice('Falha ao desconectar. Tente novamente.');
    }
  };

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">Google Drive</h2>
      <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
        {status?.conectado ? (
          <>
            <span className="truncate">{status.email ? `Conectado como ${status.email}` : 'Conectado'}</span>
            <button
              type="button"
              onClick={() => void desconectar()}
              className="min-h-[44px] shrink-0 rounded px-3 text-neutral-400 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Desconectar
            </button>
          </>
        ) : (
          <>
            <span className="py-2 text-neutral-400">{status ? 'Não conectado' : 'Carregando…'}</span>
            {status && (
              <button
                type="button"
                disabled={conexao.conectando}
                onClick={() =>
                  void conexao.conectar().then((ok) => onNotice(ok ? 'Google Drive conectado.' : 'A autorização do Google não foi concluída.'))
                }
                className="min-h-[44px] shrink-0 rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
              >
                {conexao.conectando ? 'Esperando o Google…' : 'Conectar o Google Drive'}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SecaoTelegram({ onNotice }: { onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['telegramStatus'], queryFn: api.telegramStatus });
  const [conectando, setConectando] = useState(false);
  const atualizar = () => qc.invalidateQueries({ queryKey: ['telegramStatus'] });

  const desconectar = async () => {
    try {
      await api.telegramDesconectar();
      atualizar();
      onNotice('Telegram desconectado. A sessão do Astroflix foi encerrada também no Telegram.');
    } catch {
      onNotice('Falha ao desconectar. Tente novamente.');
    }
  };

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">Telegram</h2>
      <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
        {status?.conectado ? (
          <>
            <span className="truncate">{status.usuario ? `Conectado como ${status.usuario}` : 'Conectado'}</span>
            <button
              type="button"
              onClick={() => void desconectar()}
              className="min-h-[44px] shrink-0 rounded px-3 text-neutral-400 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Desconectar
            </button>
          </>
        ) : (
          <>
            <span className="py-2 text-neutral-400">{status ? 'Nenhuma conta conectada' : 'Carregando…'}</span>
            {status && (
              <button
                type="button"
                onClick={() => setConectando(true)}
                className="min-h-[44px] shrink-0 rounded px-3 text-neutral-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Conectar
              </button>
            )}
          </>
        )}
      </div>
      {conectando && (
        <TelegramLinkModal
          soLogin
          onClose={() => setConectando(false)}
          onConectado={() => onNotice('Telegram conectado.')}
        />
      )}
    </section>
  );
}

// Onde ficam as aulas e os materiais baixados do Drive e do Telegram, quanto
// ocupam e o que fazer com eles. O app nunca apaga nada sozinho: é aqui (ou no
// menu do curso) que a pessoa libera espaço.
function SecaoArmazenamento({ onNotice }: { onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['armazenamento'], queryFn: api.armazenamento });
  const [trocando, setTrocando] = useState<string | null | undefined>(undefined);
  const [limpando, setLimpando] = useState(false);
  const [removendo, setRemovendo] = useState<{ courseId: string; titulo: string } | null>(null);

  const depois = () => {
    qc.invalidateQueries({ queryKey: ['armazenamento'] });
    qc.invalidateQueries({ queryKey: ['course'] });
    qc.invalidateQueries({ queryKey: ['downloads'] });
  };
  const ERROS: Record<string, string> = {
    forbidden: 'Essa pasta fica fora das pastas que o app pode usar.',
    'sem-permissao': 'O app não consegue gravar nessa pasta.',
  };

  const escolher = async () => {
    let p: string | null;
    try {
      p = await escolherPasta('Escolha onde guardar as aulas baixadas');
    } catch {
      return onNotice('Não foi possível abrir o seletor de pastas.');
    }
    if (p && p !== data?.pasta) setTrocando(p);
  };
  const trocar = async () => {
    const pasta = trocando;
    setTrocando(undefined);
    if (pasta === undefined) return;
    try {
      await api.trocarArmazenamento(pasta);
      depois();
      onNotice('Pasta de downloads trocada. Os próximos downloads vão para ela.');
    } catch (e) {
      onNotice(ERROS[(e as Error).message] ?? 'Não deu para trocar a pasta. Tente de novo.');
    }
  };
  const limpar = async () => {
    setLimpando(false);
    try {
      await api.limparArmazenamento();
      depois();
      onNotice('Downloads apagados. As aulas continuam tocando pela internet.');
    } catch {
      onNotice('Não deu para limpar. Tente de novo.');
    }
  };
  const remover = async () => {
    const r = removendo;
    setRemovendo(null);
    if (!r) return;
    try {
      await api.removerBaixados(r.courseId);
      depois();
      onNotice(`Download de "${r.titulo}" removido.`);
    } catch {
      onNotice('Não deu para remover. Tente de novo.');
    }
  };

  const botao =
    'min-h-[44px] shrink-0 rounded-lg bg-neutral-800 px-3 text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40';

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold text-neutral-300">Armazenamento</h2>
      <p className="mb-3 text-sm text-neutral-500">
        As aulas do Drive e do Telegram são baixadas para esta pasta, com os nomes originais. Pode abrir e levar os arquivos para onde
        quiser: o que sair dela volta a tocar pela internet.
      </p>
      <div className="rounded-lg bg-neutral-900 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-neutral-200" title={data?.pasta}>
              {data?.pasta ?? 'Carregando…'}
            </div>
            {data && (
              <div className="text-xs tabular-nums text-neutral-500">
                {formatBytes(data.bytes)} baixados{data.livre != null ? ` · ${formatBytes(data.livre)} livres no disco` : ''}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={botao} onClick={() => void api.abrirArmazenamento().catch(() => onNotice('Não deu para abrir a pasta.'))}>
              Abrir pasta
            </button>
            <button type="button" className={botao} onClick={() => void escolher()}>
              Trocar…
            </button>
            {data && !data.padrao && (
              <button type="button" className={botao} onClick={() => setTrocando(null)}>
                Usar a padrão
              </button>
            )}
          </div>
        </div>
      </div>

      {data && data.cursos.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.cursos.map((c) => (
            <div key={c.courseId} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-900 px-3 py-1 text-sm">
              <Link to={`/course/${c.courseId}`} className="min-w-0 truncate hover:underline">
                {c.titulo}
              </Link>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-xs tabular-nums text-neutral-500">
                  {c.arquivos} arquivo{plural(c.arquivos)} · {formatBytes(c.bytes)}
                </span>
                <button
                  type="button"
                  onClick={() => void api.abrirArmazenamento(c.courseId).catch(() => onNotice('Não deu para abrir a pasta.'))}
                  className="min-h-[44px] rounded px-2 text-neutral-400 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Abrir
                </button>
                <button
                  type="button"
                  onClick={() => setRemovendo({ courseId: c.courseId, titulo: c.titulo })}
                  className="min-h-[44px] rounded px-2 text-neutral-400 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Remover…
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setLimpando(true)}
              className="min-h-[44px] rounded px-3 text-sm text-neutral-400 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Limpar tudo…
            </button>
          </div>
        </div>
      )}

      {trocando !== undefined && (
        <ConfirmDialog
          title="Trocar a pasta de downloads?"
          message={
            <>
              Os próximos downloads vão para <b className="text-neutral-200">{trocando ?? 'a pasta padrão do app'}</b>. O que já foi baixado
              fica onde está (pode mover ou apagar), e essas aulas passam a aparecer como não baixadas.
            </>
          }
          confirmLabel="Trocar"
          onConfirm={() => void trocar()}
          onCancel={() => setTrocando(undefined)}
        />
      )}
      {limpando && (
        <ConfirmDialog
          title="Apagar todos os downloads?"
          message={`Para os downloads em andamento e apaga ${data ? formatBytes(data.bytes) : 'tudo'} baixados nesta pasta. Os cursos e o progresso ficam; as aulas voltam a tocar pela internet.`}
          confirmLabel="Apagar"
          danger
          onConfirm={() => void limpar()}
          onCancel={() => setLimpando(false)}
        />
      )}
      {removendo && (
        <ConfirmDialog
          title={`Remover o download de "${removendo.titulo}"?`}
          message="Apaga as aulas e os materiais baixados deste curso. O curso e o progresso ficam."
          confirmLabel="Remover"
          danger
          onConfirm={() => void remover()}
          onCancel={() => setRemovendo(null)}
        />
      )}
    </section>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: info } = useQuery({ queryKey: ['info'], queryFn: api.getInfo });
  const [countdown, setCountdown] = useState<number>(() => getPref('player.countdownSeconds', 20));
  const [autoplay, setAutoplay] = useState<boolean>(() => getPref('player.autoplay', true));
  // A mesma chave que a aba Cursos lê (libView).
  const [visao, setVisao] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('libView') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const { data: categorias } = useCollections();
  const [apagando, setApagando] = useState<Collection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apagarCategoria = async () => {
    const c = apagando;
    setApagando(null);
    if (!c) return;
    try {
      await api.deleteCollection(c.id);
      void qc.invalidateQueries();
      setNotice(`Categoria "${c.name}" apagada. O que estava nela foi para Sem categoria.`);
    } catch {
      setNotice('Não deu para apagar a categoria. Tente de novo.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200">
        <ArrowLeft size={16} /> Categorias
      </Link>
      <h1 className="mt-3 mb-6 text-2xl font-semibold tracking-tight">Configurações</h1>

      {notice && (
        <div className="mb-6">
          <Banner tone="info">{notice}</Banner>
        </div>
      )}

      <SecaoConta />
      <PainelDownloads />
      <SecaoPomodoro />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">Aparência</h2>
        <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
          Cursos em
          <div className="inline-flex overflow-hidden rounded-lg border border-neutral-800" role="radiogroup" aria-label="Cursos em">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={visao === v}
                onClick={() => {
                  setVisao(v);
                  try {
                    localStorage.setItem('libView', v);
                  } catch {
                    /* modo privado */
                  }
                }}
                className={`min-h-[40px] px-3 ${visao === v ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'}`}
              >
                {v === 'grid' ? 'Grade' : 'Lista'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">Reprodução</h2>
        <label className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
          Segundos do contador de fim
          <TextField
            type="number"
            min={3}
            max={120}
            value={countdown}
            onChange={(e) => { const n = Number(e.target.value); setCountdown(n); setPref('player.countdownSeconds', n); }}
            className="w-20 text-right"
          />
        </label>
        <label className="mt-2 flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
          Avançar automaticamente ao fim (padrão)
          <span className="grid h-11 w-11 place-items-center">
            <input
              type="checkbox"
              checked={autoplay}
              onChange={(e) => { setAutoplay(e.target.checked); setPref('player.autoplay', e.target.checked); }}
              className="h-4 w-4 accent-blue-600"
            />
          </span>
        </label>
      </section>

      <SecaoArmazenamento onNotice={setNotice} />
      <SecaoDrive onNotice={setNotice} />
      <SecaoAnki />
      <SecaoTelegram onNotice={setNotice} />

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-red-400">Apagar categoria</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Só a categoria some: os cursos, os PDFs e as questões dela vão para Sem categoria, com o progresso intacto.
        </p>
        {(categorias ?? []).length === 0 ? (
          <div className="text-sm text-neutral-600">Nenhuma categoria.</div>
        ) : (
          <div className="space-y-1">
            {(categorias ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-1 text-sm">
                <span className="truncate">
                  {c.emoji && <span className="mr-2" aria-hidden>{c.emoji}</span>}
                  {c.name}
                </span>
                <button
                  type="button"
                  onClick={() => setApagando(c)}
                  className="min-h-[44px] shrink-0 rounded px-3 text-neutral-400 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Apagar…
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {apagando && (
        <ConfirmDialog
          title={`Apagar a categoria "${apagando.name}"?`}
          message="Os cursos, os PDFs e as questões dela vão para Sem categoria. Não dá para desfazer."
          confirmLabel="Apagar categoria"
          danger
          digitar="confirmar"
          onConfirm={() => void apagarCategoria()}
          onCancel={() => setApagando(null)}
        />
      )}

      {/* Versão do build — para saber quando houve uma atualização de verdade. */}
      <footer className="mt-10 border-t border-neutral-900 pt-4 text-xs text-neutral-600">
        Astroflix · versão {info?.version ?? '—'}
      </footer>

    </div>
  );
}
