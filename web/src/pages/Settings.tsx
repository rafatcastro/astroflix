import { useEffect, useRef, useState } from 'react';
import { cliqueFora } from '../lib/desktop';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CredencialDrive, type ImportPlan } from '../api/client';
import { getPref, setPref } from '../lib/prefs';
import DirPicker from '../components/DirPicker';
import TelegramLinkModal from '../components/TelegramLinkModal';
import TextField from '../components/TextField';
import ConfirmDialog from '../components/ConfirmDialog';
import Banner from '../components/Banner';
import { ArrowLeft, Download, Upload } from '../components/icons';

const plural = (n: number) => (n === 1 ? '' : 's');

// A prévia é o momento em que a pessoa decide. Lista item a item em vez de uma
// frase corrida, e diz o que acontece com cada grupo — principalmente com os
// cursos que já existem, que é onde mora o medo de perder progresso.
function PreviaDoImport({ plan }: { plan: ImportPlan }) {
  const nada = plan.created === 0 && plan.merged === 0 && plan.collectionsCreated === 0 && plan.newRoots.length === 0 &&
    plan.driveAusentes.length === 0;
  if (nada) return <>Este arquivo não traz nada que você já não tenha. Importar não mudaria nada.</>;

  return (
    <ul className="space-y-1.5">
      {plan.created > 0 && (
        <li>
          <strong className="text-neutral-200">{plan.created}</strong> curso{plural(plan.created)} novo
          {plural(plan.created)}
        </li>
      )}
      {plan.merged > 0 && (
        <li>
          <strong className="text-neutral-200">{plan.merged}</strong> já existe{plan.merged === 1 ? '' : 'm'} aqui — fica
          o progresso mais avançado dos dois, e aula concluída não volta atrás
        </li>
      )}
      {plan.collectionsCreated > 0 && (
        <li>
          <strong className="text-neutral-200">{plan.collectionsCreated}</strong> biblioteca
          {plural(plan.collectionsCreated)} nova{plural(plan.collectionsCreated)}
        </li>
      )}
      {plan.missingFolder > 0 && (
        <li>
          <strong className="text-neutral-200">{plan.missingFolder}</strong> com a pasta não encontrada nesta máquina (
          {plan.missingFolderTitles.slice(0, 3).join(', ')}
          {plan.missingFolderTitles.length > 3 ? '…' : ''}) — entra{plan.missingFolder === 1 ? '' : 'm'} assim mesmo, com
          o progresso; depois use “Re-apontar pasta…” no menu do curso
        </li>
      )}
      {plan.driveAusentes.length > 0 && (
        <li>
          <strong className="text-neutral-200">{plan.driveAusentes.length}</strong> curso
          {plural(plan.driveAusentes.length)} do Google Drive ou do Telegram — adicione o link e importe de novo para trazer o progresso
        </li>
      )}
      {plan.newRoots.length > 0 && (
        <li>
          libera o app para ler {plan.newRoots.length === 1 ? 'a pasta' : 'as pastas'}{' '}
          <strong className="text-neutral-200">{plan.newRoots.join(', ')}</strong> — só importe se este arquivo for seu
        </li>
      )}
    </ul>
  );
}

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
          <li>Deixe o Anki aberto enquanto estuda. Os cards entram no baralho Learnflix::Cursos e sincronizam com o AnkiWeb.</li>
        </ol>
      </details>
    </section>
  );
}

function SecaoDrive({ onNotice }: { onNotice: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['driveStatus'], queryFn: api.driveStatus });
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
          <span className="py-2 text-neutral-400">{status ? 'Nenhuma conta conectada' : 'Carregando…'}</span>
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
      onNotice('Telegram desconectado. A sessão do Learnflix foi encerrada também no Telegram.');
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
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const { data: info } = useQuery({ queryKey: ['info'], queryFn: api.getInfo });
  const [picking, setPicking] = useState(false);
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
  const [confirmReset, setConfirmReset] = useState<null | 'progress' | 'library'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  // Guarda o arquivo junto com a prévia: confirmar precisa mandar exatamente o
  // mesmo conteúdo que gerou aquelas contagens.
  const [previa, setPrevia] = useState<{ plan: ImportPlan; data: unknown } | null>(null);
  const [importando, setImportando] = useState(false);

  const escolherArquivo = async (file: File) => {
    setNotice(null);
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setNotice('Não deu para ler esse arquivo — ele não é um JSON válido.');
      return;
    }
    try {
      setPrevia({ plan: await api.importPreview(data), data });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não deu para ler esse arquivo.');
    }
  };

  const doImport = async () => {
    if (!previa) return;
    const { data } = previa;
    setPrevia(null);
    setImportando(true);
    try {
      const r = await api.importLibrary(data);
      qc.invalidateQueries();
      const partes = [
        r.created > 0 ? `${r.created} curso${plural(r.created)} novo${plural(r.created)}` : null,
        r.merged > 0 ? `${r.merged} atualizado${plural(r.merged)}` : null,
      ].filter(Boolean);
      setNotice(
        partes.length
          ? `Importação concluída: ${partes.join(', ')}. Nada do que você já tinha foi perdido.`
          : 'Importação concluída — esse arquivo não trazia nada de novo.',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Falha ao importar. Tente novamente.');
    } finally {
      setImportando(false);
    }
  };

  const doResetProgress = async () => {
    setConfirmReset(null);
    try {
      const r = await api.resetAllProgress();
      qc.invalidateQueries({ queryKey: ['courses'] });
      setNotice(`Progresso zerado em toda a biblioteca (${r.deleted} registro${r.deleted === 1 ? '' : 's'}).`);
    } catch {
      setNotice('Falha ao zerar o progresso. Tente novamente.');
    }
  };

  const doResetLibrary = async () => {
    setConfirmReset(null);
    try {
      const r = await api.resetLibrary();
      qc.invalidateQueries();
      setNotice(`Biblioteca zerada: ${r.courses} curso${r.courses === 1 ? '' : 's'} removido${r.courses === 1 ? '' : 's'}. Os vídeos no disco estão intactos.`);
    } catch {
      setNotice('Falha ao zerar a biblioteca. Tente novamente.');
    }
  };

  const roots = data?.allowedRootsExtra ?? [];
  const saveRoots = async (next: string[]) => {
    await api.patchSettings({ allowedRootsExtra: next });
    qc.invalidateQueries({ queryKey: ['settings'] });
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

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Pastas-raiz permitidas</h2>
        <p className="mb-3 text-sm text-neutral-500">Pastas onde o seletor pode navegar (além das definidas no servidor).</p>
        <div className="space-y-1">
          {roots.length === 0 && <div className="text-sm text-neutral-600">Nenhuma raiz extra.</div>}
          {roots.map((r) => (
            <div key={r} className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
              <span className="truncate">{r}</span>
              <button
                className="min-h-[44px] rounded px-3 text-neutral-400 hover:text-red-400"
                onClick={() => void saveRoots(roots.filter((x) => x !== r))}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
        <button
          className="mt-3 min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500"
          onClick={() => setPicking(true)}
        >
          + Adicionar pasta-raiz
        </button>
      </section>

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

      <SecaoConta />
      <SecaoDrive onNotice={setNotice} />
      <SecaoAnki />
      <SecaoTelegram onNotice={setNotice} />

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-neutral-300">Backup e migração</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Um arquivo com seus cursos, bibliotecas e todo o progresso. Serve de backup e para levar tudo a outro
          computador. Os vídeos não vão junto — só o que você construiu em cima deles.
        </p>
        <div className="space-y-2">
          <a
            href={api.exportLibraryUrl}
            onClick={(e) => cliqueFora(e, api.exportLibraryUrl)}
            className="flex w-full items-center gap-3 rounded-lg bg-neutral-900 px-3 py-3 text-sm no-underline hover:bg-neutral-800"
          >
            <Download size={18} className="shrink-0 text-neutral-400" />
            <span>
              Exportar biblioteca
              <span className="mt-0.5 block text-xs text-neutral-500">
                Baixa um arquivo .json com a data de hoje. Guarde-o onde quiser.
              </span>
            </span>
          </a>
          <button
            type="button"
            disabled={importando}
            onClick={() => arquivoRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-lg bg-neutral-900 px-3 py-3 text-left text-sm hover:bg-neutral-800 disabled:opacity-60"
          >
            <Upload size={18} className="shrink-0 text-neutral-400" />
            <span>
              {importando ? 'Importando…' : 'Importar arquivo…'}
              <span className="mt-0.5 block text-xs text-neutral-500">
                Mostra o que vai acontecer antes de confirmar. A importação só soma: nada do que está aqui é apagado.
              </span>
            </span>
          </button>
          <input
            ref={arquivoRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Zera o valor: sem isso, escolher o MESMO arquivo de novo (depois
              // de um erro, por exemplo) não dispara change nenhum.
              e.target.value = '';
              if (file) void escolherArquivo(file);
            }}
          />
        </div>
      </section>

      {/* Reset é decisão pesada: fica no fim, visualmente separado, sempre com confirmação. */}
      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-red-400">Zona de perigo</h2>
        <p className="mb-3 text-sm text-neutral-500">Ações irreversíveis — os vídeos no disco nunca são tocados.</p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setConfirmReset('progress')}
            className="block w-full rounded-lg bg-neutral-900 px-3 py-3 text-left text-sm hover:bg-neutral-800"
          >
            Zerar progresso de todos os cursos
            <span className="mt-0.5 block text-xs text-neutral-500">Posições e aulas concluídas voltam a zero; cursos e coleções permanecem.</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset('library')}
            className="block w-full rounded-lg border border-red-900/60 bg-neutral-900 px-3 py-3 text-left text-sm text-red-400 hover:bg-red-950/40"
          >
            Apagar toda a biblioteca…
            <span className="mt-0.5 block text-xs text-neutral-500">Remove todos os cursos, progresso e coleções — recomeço do zero.</span>
          </button>
        </div>
      </section>

      {previa && (
        <ConfirmDialog
          title="Importar esta biblioteca?"
          message={<PreviaDoImport plan={previa.plan} />}
          confirmLabel="Importar"
          onConfirm={() => void doImport()}
          onCancel={() => setPrevia(null)}
        />
      )}
      {confirmReset === 'progress' && (
        <ConfirmDialog
          title="Zerar o progresso de todos os cursos?"
          message="Posições de reprodução e aulas concluídas de TODA a biblioteca voltam a zero. Cursos, coleções e capas permanecem. Não dá para desfazer."
          confirmLabel="Zerar progresso"
          danger
          onConfirm={doResetProgress}
          onCancel={() => setConfirmReset(null)}
        />
      )}
      {confirmReset === 'library' && (
        <ConfirmDialog
          title="Apagar TODA a biblioteca?"
          message="Remove todos os cursos, progresso, coleções e miniaturas do banco — recomeço do zero. Os arquivos de vídeo no disco não são tocados. Não dá para desfazer."
          confirmLabel="Apagar tudo"
          danger
          onConfirm={doResetLibrary}
          onCancel={() => setConfirmReset(null)}
        />
      )}

      {/* Versão do build — para saber quando houve uma atualização de verdade. */}
      <footer className="mt-10 border-t border-neutral-900 pt-4 text-xs text-neutral-600">
        Learnflix · versão {info?.version ?? '—'}
      </footer>

      {picking && (
        <DirPicker
          onClose={() => setPicking(false)}
          onPick={(p) => { void saveRoots([...roots, p]); setPicking(false); }}
        />
      )}
    </div>
  );
}
