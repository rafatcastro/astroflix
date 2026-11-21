// O popup: pareia com o Astroflix (a chave das Configurações), lista as playlists
// e manda a aula aberta para a escolhida. O "Importar várias aulas" só dispara o
// trabalho, que roda no background.js: o popup fecha quando perde o foco.
import { useEffect, useRef, useState } from 'react';
import {
  acharApp,
  api,
  ERROS,
  lerConfig,
  playlistsComDestino,
  separar,
  textosDoSeletor,
  tituloDaAula,
  type Config,
  type Lote,
  type Playlist,
  type VideoVisto,
} from './app';

interface Mensagem {
  texto: string;
  tipo?: 'erro' | 'ok';
}
type Avisar = (texto: string, tipo?: Mensagem['tipo']) => void;
type Tela = 'iniciando' | 'parear' | 'principal' | 'sem-app';

export function Popup() {
  const [tela, setTela] = useState<Tela>('iniciando');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [aba, setAba] = useState<chrome.tabs.Tab | null>(null);
  const [msg, setMsg] = useState<Mensagem>({ texto: '' });
  const avisar: Avisar = (texto, tipo) => setMsg({ texto, tipo });

  useEffect(() => {
    void (async () => {
      const c = await lerConfig();
      const [a] = await chrome.tabs.query({ active: true, currentWindow: true });
      setAba(a ?? null);
      setCfg(c);
      if (!c.chave) return setTela('parear');
      const r = await acharApp(c.chave, c.porta);
      if ('erro' in r) {
        avisar(ERROS[r.erro], 'erro');
        return setTela(r.erro === 'chave-errada' ? 'parear' : 'sem-app');
      }
      await chrome.storage.local.set({ porta: r.porta });
      setCfg({ ...c, porta: r.porta });
      setTela('principal');
    })();
  }, []);

  const pareado = (chave: string, porta: number) => {
    setCfg((c) => ({ ...(c ?? { ultimaPlaylist: null }), chave, porta }));
    avisar('');
    setTela('principal');
  };

  return (
    <main>
      <h1>Adicionar ao Astroflix</h1>
      {tela === 'parear' && cfg && <Pareamento porta={cfg.porta} avisar={avisar} aoParear={pareado} />}
      {tela === 'principal' && cfg && aba && <Principal cfg={cfg} aba={aba} avisar={avisar} />}
      <p className={`aviso ${msg.tipo ?? ''}`} role="status">
        {msg.texto}
      </p>
      {(tela === 'principal' || tela === 'sem-app') && (
        <p className="aviso">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              avisar('');
              setTela('parear');
            }}
          >
            Trocar a chave
          </a>
        </p>
      )}
    </main>
  );
}

function Pareamento({ porta, avisar, aoParear }: { porta: number | null; avisar: Avisar; aoParear: (chave: string, porta: number) => void }) {
  const [chave, setChave] = useState('');

  async function conectar() {
    const c = chave.trim();
    if (!c) return;
    avisar('Procurando o Astroflix…');
    const r = await acharApp(c, porta);
    if ('erro' in r) return avisar(ERROS[r.erro], 'erro');
    await chrome.storage.local.set({ chave: c, porta: r.porta });
    aoParear(c, r.porta);
  }

  return (
    <section>
      <p className="aviso">
        No Astroflix, abra <b>Configurações → Extensão do navegador</b>, copie a chave e cole aqui. O app precisa estar aberto.
      </p>
      <label htmlFor="chave">Chave</label>
      <input
        id="chave"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        value={chave}
        onChange={(e) => setChave(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void conectar()}
      />
      <button className="principal" onClick={() => void conectar()}>
        Conectar
      </button>
    </section>
  );
}

function Principal({ cfg, aba, avisar }: { cfg: Config; aba: chrome.tabs.Tab; avisar: Avisar }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [valor, setValor] = useState('');
  const [novaAberta, setNovaAberta] = useState(false);
  const [novaNome, setNovaNome] = useState('');
  const novaRef = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState('');
  const [videos, setVideos] = useState<VideoVisto[]>([]);
  const [marcado, setMarcado] = useState('pagina');
  const [enviando, setEnviando] = useState(false);

  async function carregarPlaylists(escolher?: string) {
    const r = await playlistsComDestino(cfg, escolher ?? valor);
    setPlaylists(r.playlists);
    setValor(r.alvo ?? (r.playlists[0] ? `${r.playlists[0].id}|` : ''));
    if (!r.playlists.length) avisar('Nenhuma playlist ainda: crie uma com o +.');
  }

  useEffect(() => {
    void (async () => {
      try {
        await carregarPlaylists(cfg.ultimaPlaylist ?? '');
      } catch (e) {
        const m = (e as Error).message;
        return avisar(ERROS[m] ?? `Erro: ${m}`, 'erro');
      }
      setTitulo(await tituloDaAula(aba));
      const k = `aba:${aba.id}`;
      const todos = ((await chrome.storage.session.get(k))[k] as VideoVisto[] | undefined) ?? [];
      // Os desta página primeiro (num site em JavaScript a aba guarda os das aulas
      // anteriores também); dentro, a lista do HLS/DASH antes de um .mp4 solto.
      const peso = (v: VideoVisto) => (v.pagina === aba.url ? 0 : 2) + (/\.(m3u8|mpd)(\?|$)/i.test(v.url) ? 0 : 1);
      const ordenados = [...todos].sort((a, b) => peso(a) - peso(b) || b.quando - a.quando);
      setVideos(ordenados);
      setMarcado(ordenados.length ? '0' : 'pagina');
    })();
    // Só na abertura do popup: cfg e aba não mudam enquanto ele está aberto.
  }, []);

  async function adicionar() {
    const { id: playlist, modulo } = separar(valor);
    if (!playlist) return avisar('Escolha ou crie uma playlist.', 'erro');
    const v = marcado === 'pagina' ? null : videos[Number(marcado)];
    setEnviando(true);
    try {
      const r = await api<{ repetido?: boolean; posicao: number }>(cfg, `/api/extensao/playlists/${playlist}/itens`, {
        method: 'POST',
        body: JSON.stringify({
          url: v?.url ?? aba.url,
          titulo: titulo.trim() || aba.title,
          pagina: aba.url,
          cabecalhos: v?.cabecalhos ?? [],
          modulo,
        }),
      });
      await chrome.storage.local.set({ ultimaPlaylist: valor });
      avisar(
        r.repetido ? `Essa aula já estava na playlist (nº ${r.posicao}); o endereço foi atualizado.` : `Adicionada como aula ${r.posicao}. O Astroflix está baixando.`,
        'ok',
      );
      await carregarPlaylists(valor);
    } catch (e) {
      const m = (e as Error).message;
      avisar(ERROS[m] ?? `Não deu: ${m}`, 'erro');
    } finally {
      setEnviando(false);
    }
  }

  async function criar(dentro: boolean) {
    const nome = novaNome.trim();
    if (!nome) return novaRef.current?.focus();
    const { id } = separar(valor);
    if (dentro && !id) return avisar('Escolha antes a playlist onde criar.', 'erro');
    try {
      let novo: string;
      if (dentro) {
        const r = await api<{ pasta: string }>(cfg, `/api/extensao/playlists/${id}/modulos`, { method: 'POST', body: JSON.stringify({ titulo: nome }) });
        novo = `${id}|${r.pasta}`;
      } else {
        const r = await api<{ id: string }>(cfg, '/api/extensao/playlists', { method: 'POST', body: JSON.stringify({ titulo: nome }) });
        novo = `${r.id}|`;
      }
      setNovaAberta(false);
      setNovaNome('');
      await carregarPlaylists(novo);
      avisar(dentro ? `"${nome}" criada dentro da playlist.` : `Playlist "${nome}" criada.`, 'ok');
    } catch (e) {
      avisar(`Não deu: ${(e as Error).message}`, 'erro');
    }
  }

  return (
    <section>
      <label htmlFor="playlist">Playlist</label>
      <div className="linha">
        {/* Cada playlist e, embaixo dela, as sub-playlists (módulos). O valor é
            "id|subpasta" (subpasta vazia = a raiz da playlist). */}
        <select id="playlist" value={valor} onChange={(e) => setValor(e.target.value)}>
          {playlists.flatMap((p) => [
            <option key={`${p.id}|`} value={`${p.id}|`}>
              {p.titulo} ({p.itens})
            </option>,
            ...(p.modulos ?? []).map((m) => (
              <option key={`${p.id}|${m.pasta}`} value={`${p.id}|${m.pasta}`}>
                {`   ↳ ${m.nome} (${m.itens})`}
              </option>
            )),
          ])}
        </select>
        <button
          title="Nova playlist"
          onClick={() => {
            setNovaAberta((a) => !a);
            setTimeout(() => novaRef.current?.focus());
          }}
        >
          +
        </button>
      </div>
      {novaAberta && (
        <div style={{ marginTop: 6 }}>
          <input ref={novaRef} placeholder="Nome" value={novaNome} onChange={(e) => setNovaNome(e.target.value)} />
          <div className="linha" style={{ marginTop: 6 }}>
            <button className="cheio" onClick={() => void criar(false)}>
              Playlist nova
            </button>
            <button className="cheio" onClick={() => void criar(true)}>
              Dentro da escolhida
            </button>
          </div>
        </div>
      )}

      <label htmlFor="titulo">Título da aula</label>
      <input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />

      <label>Vídeo</label>
      <div className="videos">
        {videos.map((v, i) => (
          <label key={v.url} className="video">
            <input type="radio" name="video" checked={marcado === String(i)} onChange={() => setMarcado(String(i))} />
            {`${v.pagina === aba.url ? '' : '(outra página) '}${v.url}`}
          </label>
        ))}
        <label className="video">
          <input type="radio" name="video" checked={marcado === 'pagina'} onChange={() => setMarcado('pagina')} />
          {videos.length ? 'Nenhum destes: mandar só a página' : 'Nenhum vídeo visto ainda: dê play e abra de novo, ou mande a página'}
        </label>
      </div>

      <button className="principal" disabled={enviando} onClick={() => void adicionar()}>
        Adicionar
      </button>

      <ImportarVarias aba={aba} valor={valor} avisar={avisar} />
    </section>
  );
}

// ---------- Importar várias aulas (roda no background.js) ----------

const SELETOR_PADRAO = 'p.text-sm.font-family-body.text-body.font-semibold';
type Modo = 'seguir' | 'lista';

function ImportarVarias({ aba, valor, avisar }: { aba: chrome.tabs.Tab; valor: string; avisar: Avisar }) {
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<Modo>('seguir');
  const [textoBotao, setTextoBotao] = useState('Próxima');
  const [seletor, setSeletor] = useState(SELETOR_PADRAO);
  const [contagem, setContagem] = useState<{ info: string; pode: boolean }>({ info: '', pode: true });
  const [lote, setLote] = useState<Lote | null>(null);

  useEffect(() => {
    void chrome.storage.local.get(['seletor', 'textoBotao', 'modoLote']).then((guardado) => {
      const s = guardado as { seletor?: string; textoBotao?: string; modoLote?: Modo };
      if (s.seletor) setSeletor(s.seletor);
      if (s.textoBotao) setTextoBotao(s.textoBotao);
      if (s.modoLote === 'lista') setModo('lista');
    });
    const ler = async () => {
      const l = (await chrome.storage.session.get('lote')).lote as Lote | undefined;
      setLote(l ?? null);
      if (l?.ativo) setAberto(true);
    };
    void ler();
    const mudou = (m: Record<string, chrome.storage.StorageChange>) => m.lote && void ler();
    chrome.storage.session.onChanged.addListener(mudou);
    return () => chrome.storage.session.onChanged.removeListener(mudou);
  }, []);

  // No modo lista, conta as aulas que o seletor acha na página (só com a seção
  // aberta: cada contagem roda um script na aba).
  async function contar(m: Modo, sel: string) {
    if (m === 'seguir') return setContagem({ info: '', pode: true });
    try {
      const t = await textosDoSeletor(aba.id!, sel.trim());
      if (!t) return setContagem({ info: 'Seletor inválido.', pode: false });
      setContagem({
        info: t.length
          ? `${t.length} aula(s): ${t.slice(0, 3).join(' · ')}${t.length > 3 ? ' …' : ''}. Cada uma é clicada e o vídeo que o player abrir vai para a playlist escolhida acima.`
          : 'Nenhuma aula com esse seletor nesta página (abra a lista de aulas).',
        pode: t.length > 0,
      });
    } catch {
      setContagem({ info: 'Não dá para ler esta página.', pode: false });
    }
  }

  async function trocarModo(m: Modo) {
    setModo(m);
    await chrome.storage.local.set({ modoLote: m });
    await contar(m, seletor);
  }

  async function ir() {
    const { id: playlist, modulo } = separar(valor);
    if (!playlist) return avisar('Escolha ou crie uma playlist.', 'erro');
    const botao = textoBotao.trim() || 'Próxima';
    await chrome.storage.local.set({ seletor: seletor.trim(), textoBotao: textoBotao.trim(), ultimaPlaylist: valor });
    if (modo === 'seguir') await chrome.runtime.sendMessage({ tipo: 'importar-seguindo', tabId: aba.id, textoBotao: botao, playlist, modulo });
    else await chrome.runtime.sendMessage({ tipo: 'importar-pagina', tabId: aba.id, seletor: seletor.trim(), playlist, modulo });
  }

  const info =
    modo === 'seguir'
      ? `Manda esta aula, clica em "${textoBotao.trim() || 'Próxima'}", espera o vídeo da próxima e repete até a última. Aula sem vídeo é pulada. Não mexa nesta aba enquanto importa.`
      : contagem.info;

  return (
    <details
      open={aberto}
      onToggle={(e) => {
        const a = e.currentTarget.open;
        setAberto(a);
        if (a) void contar(modo, seletor);
      }}
    >
      <summary>Importar várias aulas</summary>
      <label className="video modo">
        <input type="radio" name="modo" checked={modo === 'seguir'} onChange={() => void trocarModo('seguir')} /> Desta aula em diante, clicando no botão
      </label>
      {modo === 'seguir' && (
        <input
          spellCheck={false}
          aria-label="Texto do botão"
          value={textoBotao}
          onChange={(e) => setTextoBotao(e.target.value)}
          onBlur={() => void chrome.storage.local.set({ textoBotao: textoBotao.trim() })}
        />
      )}
      <label className="video modo">
        <input type="radio" name="modo" checked={modo === 'lista'} onChange={() => void trocarModo('lista')} /> Clicando em cada aula da lista
      </label>
      {modo === 'lista' && (
        <input
          spellCheck={false}
          aria-label="Seletor das aulas"
          value={seletor}
          onChange={(e) => setSeletor(e.target.value)}
          onBlur={() => {
            void chrome.storage.local.set({ seletor: seletor.trim() });
            void contar('lista', seletor);
          }}
        />
      )}
      <p className="aviso">{info}</p>
      <div className="linha">
        {lote?.ativo ? (
          <button onClick={() => void chrome.runtime.sendMessage({ tipo: 'parar-lote' })}>Parar</button>
        ) : (
          <button className="cheio" disabled={modo === 'lista' && !contagem.pode} onClick={() => void ir()}>
            Importar todas
          </button>
        )}
      </div>
      <p className="aviso" role="status">
        {estadoDoLote(lote)}
      </p>
    </details>
  );
}

function estadoDoLote(l: Lote | null): string {
  if (!l) return '';
  const falhas = l.falhas?.length ? ` Puladas: ${l.falhas.length} (${l.falhas.slice(-3).join('; ')}).` : '';
  const de = l.total == null ? '' : ` de ${l.total}`;
  if (l.ativo) return `Importando: ${l.feitos ?? 0}${de} mandada(s)… ${l.atual ?? ''}.${falhas}`;
  if (!l.terminou) return '';
  const fim = l.terminou === 'ok' ? 'Pronto' : l.terminou === 'parado' ? 'Parado' : `Parou: ${l.terminou}`;
  return `${fim}. ${l.feitos ?? 0}${de} mandada(s) ao Astroflix.${falhas}`;
}
