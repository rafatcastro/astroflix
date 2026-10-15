import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cliqueFora } from '../lib/desktop';
import { api, type Collection, type CredencialDrive } from '../api/client';
import { useCollections, useConexaoDrive } from '../api/hooks';
import { CONFIG_PADRAO, lerConfig, salvarConfig, type ConfigPomodoro } from '../lib/pomodoro';
import { getPref, setPref } from '../lib/prefs';
import TelegramLinkModal from '../components/TelegramLinkModal';
import TextField from '../components/TextField';
import ConfirmDialog from '../components/ConfirmDialog';
import Banner from '../components/Banner';
import { ArrowLeft } from '../components/icons';

const plural = (n: number) => (n === 1 ? '' : 's');



const CAMPOS_DRIVE: { chave: CredencialDrive; rotulo: string; segredo?: boolean }[] = [
  { chave: 'clientId', rotulo: 'ID do cliente OAuth' },
  { chave: 'clientSecret', rotulo: 'Segredo do cliente OAuth', segredo: true },
  { chave: 'apiKey', rotulo: 'Chave de API', segredo: true },
];

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
  const [campos, setCampos] = useState<Record<CredencialDrive, string>>({ clientId: '', clientSecret: '', apiKey: '' });
  const [salvando, setSalvando] = useState(false);

  const desconectar = async () => {
    try {
      await api.driveDesconectar();
      qc.invalidateQueries({ queryKey: ['driveStatus'] });
      onNotice('Conta do Google desconectada.');
    } catch {
      onNotice('Falha ao desconectar. Tente novamente.');
    }
  };

  const salvar = async () => {
    // Campo vazio na API APAGA o valor; como os campos nascem vazios (o segredo nunca volta do
    // servidor), mandamos só o que a pessoa digitou para não apagar o resto sem querer.
    const preenchidos = Object.fromEntries(
      Object.entries(campos).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]),
    );
    if (Object.keys(preenchidos).length === 0) return;
    setSalvando(true);
    try {
      await api.driveSalvarCredenciais(preenchidos);
      setCampos({ clientId: '', clientSecret: '', apiKey: '' });
      qc.invalidateQueries({ queryKey: ['driveStatus'] });
      onNotice('Credenciais do Google salvas.');
    } catch {
      onNotice('Falha ao salvar as credenciais. Tente novamente.');
    }
    setSalvando(false);
  };

  // Único jeito de apagar o que foi salvo: '' nos três campos devolve tudo à env/padrão do app.
  const restaurar = async () => {
    setSalvando(true);
    try {
      await api.driveSalvarCredenciais({ clientId: '', clientSecret: '', apiKey: '' });
      setCampos({ clientId: '', clientSecret: '', apiKey: '' });
      qc.invalidateQueries({ queryKey: ['driveStatus'] });
      onNotice('Credenciais padrão restauradas.');
    } catch {
      onNotice('Falha ao restaurar as credenciais. Tente novamente.');
    }
    setSalvando(false);
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
      <details className="mt-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm">
        <summary className="min-h-[44px] cursor-pointer py-2 text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          Usar um app próprio do Google Cloud
        </summary>
        <div className="space-y-3 pb-2 pt-1">
          {CAMPOS_DRIVE.map((c) => (
            <label key={c.chave} className="block">
              <span className="mb-1 block text-neutral-400">{c.rotulo}</span>
              <TextField
                type={c.segredo ? 'password' : 'text'}
                autoComplete="off"
                value={campos[c.chave]}
                placeholder={status?.credenciais[c.chave] ? 'configurado' : ''}
                onChange={(e) => setCampos((prev) => ({ ...prev, [c.chave]: e.target.value }))}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={() => void restaurar()}
            disabled={salvando}
            className="ml-2 min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            Restaurar padrão
          </button>
        </div>
      </details>
    </section>
  );
}

function SecaoTelegram({ onNotice }: { onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['telegramStatus'], queryFn: api.telegramStatus });
  const [conectando, setConectando] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [salvando, setSalvando] = useState(false);
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

  // Mesma regra do Google: manda só o que foi digitado, porque campo vazio APAGA o valor salvo.
  const salvar = async (restaurar = false) => {
    const c = restaurar ? { apiId: '', apiHash: '' } : Object.fromEntries(
      Object.entries({ apiId: apiId.trim(), apiHash: apiHash.trim() }).filter(([, v]) => v !== ''),
    );
    if (Object.keys(c).length === 0) return;
    setSalvando(true);
    try {
      await api.telegramSalvarCredenciais(c);
      setApiId('');
      setApiHash('');
      atualizar();
      onNotice(restaurar ? 'App padrão do Telegram restaurado.' : 'App do Telegram salvo. Conecte a conta de novo.');
    } catch {
      onNotice('Falha ao salvar. Tente novamente.');
    }
    setSalvando(false);
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
      <details className="mt-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm">
        <summary className="min-h-[44px] cursor-pointer py-2 text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          Usar um app próprio do Telegram
        </summary>
        <div className="space-y-3 pb-2 pt-1">
          <p className="text-neutral-500">Crie em my.telegram.org → API development tools. Trocar o app desconecta a conta.</p>
          <label className="block">
            <span className="mb-1 block text-neutral-400">api_id</span>
            <TextField inputMode="numeric" autoComplete="off" value={apiId} placeholder={status?.credenciais.apiId ? 'configurado' : ''} onChange={(e) => setApiId(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-neutral-400">api_hash</span>
            <TextField type="password" autoComplete="off" value={apiHash} placeholder={status?.credenciais.apiHash ? 'configurado' : ''} onChange={(e) => setApiHash(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={() => void salvar(true)}
            disabled={salvando}
            className="ml-2 min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            Restaurar padrão
          </button>
        </div>
      </details>
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
        {import.meta.env.VITE_CANAL === 'develop' && ' (develop)'}
      </footer>

    </div>
  );
}
