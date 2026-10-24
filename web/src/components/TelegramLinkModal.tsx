import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type DialogoTelegram, type PreviaTelegram, type RespostaTelegram } from '../api/client';
import { mensagemErroTelegram } from '../api/telegramTextos';
import TelegramLogin from './TelegramLogin';
import TextField from './TextField';

type Fase = { tipo: 'link' } | { tipo: 'login' };

const numero = (n: number) => n.toLocaleString('pt-BR');
const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`;

// Espera a pessoa parar de digitar: cada prévia é uma ida ao Telegram, e colar
// letra por letra não pode virar uma rajada de pedidos (o Telegram responde com flood).
const ESPERA_PREVIA_MS = 600;

// O campo serve para colar o link e para buscar na lista: só o que parece link vai ao Telegram.
const pareceLink = (t: string) => /t(elegram)?\.me\/|^@|^https?:|^tg:/i.test(t.trim());
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TIPO_DIALOGO = { canal: 'Canal', grupo: 'Grupo', bot: 'Bot' } as const;

const botaoPrimario =
  'min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40';
const botaoSecundario =
  'min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/**
 * Colar o link de um grupo do Telegram e virar curso. Antes de adicionar, o
 * link vira uma prévia (foto, nome, membros, quantos vídeos), para a pessoa ver
 * o que está trazendo. Sem conta conectada, o login por QR aparece no meio do
 * caminho e, ao concluir, o link é lido de novo sozinho. `soLogin` usa o mesmo diálogo só para conectar (Configurações, player).
 */
export default function TelegramLinkModal({ onClose, soLogin, onConectado, categoriaId }: {
  onClose: () => void;
  /** Aberto dentro de uma categoria: o curso entra nela. */
  categoriaId?: string;
  soLogin?: boolean;
  onConectado?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [fase, setFase] = useState<Fase>(soLogin ? { tipo: 'login' } : { tipo: 'link' });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaTelegram | null>(null);
  const [lendo, setLendo] = useState(false);
  const [dialogos, setDialogos] = useState<DialogoTelegram[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<DialogoTelegram | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc fecha e Tab fica preso no diálogo (docs/design.md: teclado em primeiro plano).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const alvos = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'));
      if (alvos.length === 0) return;
      const primeiro = alvos[0];
      const ultimo = alvos[alvos.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Refeita a cada mudança do link (e ao voltar do login). O abort descarta a
  // resposta de um link antigo, para ela não aparecer por cima da do novo.
  // As conversas da conta, para escolher sem colar link. Relida ao voltar do login.
  useEffect(() => {
    if (fase.tipo !== 'link' || soLogin) return;
    const ctrl = new AbortController();
    void api.telegramDialogos(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.tipo === 'lista') setDialogos(r.itens);
      else if (r.tipo === 'conectar') setFase({ tipo: 'login' });
      else setErroLista(mensagemErroTelegram(r.erro, r.esperaSeg));
    });
    return () => ctrl.abort();
  }, [fase.tipo, soLogin]);

  const alvo = escolhido?.chave ?? (pareceLink(link) ? link.trim() : '');

  useEffect(() => {
    const texto = alvo;
    setPrevia(null);
    setErro(null);
    setLendo(false);
    if (!texto || fase.tipo !== 'link') return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLendo(true);
      const r = await api.telegramPrevia(texto, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setLendo(false);
      if (r.tipo === 'previa') setPrevia(r.previa);
      else if (r.tipo === 'conectar') setFase({ tipo: 'login' });
      else setErro(mensagemErroTelegram(r.erro, r.esperaSeg));
    }, ESPERA_PREVIA_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [alvo, fase.tipo]);

  const tratar = (res: RespostaTelegram) => {
    if (res.tipo === 'criado') {
      const id = res.id;
      const ir = () => {
        qc.invalidateQueries({ queryKey: ['courses'] });
        navigate(`/course/${id}`);
      };
      if (categoriaId) void api.patchCourse(id, { collectionId: categoriaId }).then(ir, ir);
      else ir();
      onClose();
      return;
    }
    if (res.tipo === 'conectar') setFase({ tipo: 'login' });
    // Convite aqui só se a prévia ficou velha (a pessoa saiu do grupo no meio).
    else if (res.tipo === 'convite') setErro(mensagemErroTelegram('sem-acesso'));
    else setErro(mensagemErroTelegram(res.erro, res.esperaSeg));
  };

  // Já é um curso: abre direto, sem reler o grupo inteiro.
  const adicionar = async () => {
    if (!previa || busy) return;
    if (previa.cursoId) {
      tratar({ tipo: 'criado', id: previa.cursoId, existente: true });
      return;
    }
    setBusy(true);
    setErro(null);
    // Entrar num grupo é uma ação na conta da pessoa: só pelo botão que diz isso.
    tratar(await (previa.convite ? api.telegramEntrarConvite(alvo) : api.telegramCriarCurso(alvo)));
    setBusy(false);
  };

  const conectou = () => {
    qc.invalidateQueries({ queryKey: ['telegramStatus'] });
    if (soLogin) {
      onConectado?.();
      onClose();
      return;
    }
    setFase({ tipo: 'link' });
  };

  const semVideos = previa !== null && !previa.convite && previa.videos === 0 && previa.arquivos === 0 && !previa.fotos;
  const rotulo = busy
    ? previa?.convite ? 'Entrando…' : 'Lendo o grupo…'
    : previa?.cursoId ? 'Abrir curso' : previa?.convite ? 'Entrar no grupo e adicionar' : 'Adicionar';

  const titulo = fase.tipo === 'login' ? 'Conectar ao Telegram' : 'Do Telegram';

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tg-modal-titulo"
        className="w-full max-w-lg rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="tg-modal-titulo" className="mb-3 font-medium">{titulo}</div>

        {fase.tipo === 'login' && (
          <>
            <p className="mb-4 text-sm text-neutral-400">
              O Astroflix abre os grupos com a sua conta do Telegram. A sessão fica só nesta máquina e aparece como
              “Astroflix” nos seus dispositivos.
            </p>
            <TelegramLogin onConectado={conectou} />
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className={botaoSecundario}>Cancelar</button>
            </div>
          </>
        )}

        {fase.tipo === 'link' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void adicionar();
            }}
          >
            <label htmlFor="tg-link" className="mb-1 block text-sm text-neutral-300">
              Cole o link ou busque um dos seus grupos, canais e bots
            </label>
            <TextField
              id="tg-link"
              autoFocus
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setEscolhido(null);
              }}
              disabled={busy}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'tg-erro' : 'tg-dica'}
              placeholder="https://t.me/… ou o nome do grupo"
            />
            {!escolhido && !pareceLink(link) && (
              <ListaDialogos
                dialogos={dialogos}
                erro={erroLista}
                busca={link}
                onEscolher={(d) => setEscolhido(d)}
              />
            )}
            {erro ? (
              <p id="tg-erro" role="alert" className="mt-2 text-sm text-amber-200">{erro}</p>
            ) : (
              <p id="tg-dica" className="mt-2 text-sm text-neutral-500">
                {lendo ? 'Lendo o grupo…' : 'Os vídeos e as fotos viram aulas na ordem em que foram postados.'}
              </p>
            )}
            <div aria-live="polite">{previa && <CartaoPrevia previa={previa} semVideos={semVideos} />}</div>
            {escolhido && (
              <button type="button" onClick={() => setEscolhido(null)} className="mt-2 text-sm text-blue-400 hover:underline">
                Escolher outro
              </button>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={botaoSecundario}>Cancelar</button>
              <button type="submit" disabled={busy || !previa || semVideos} className={botaoPrimario}>
                {rotulo}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ListaDialogos({ dialogos, erro, busca, onEscolher }: {
  dialogos: DialogoTelegram[] | null;
  erro: string | null;
  busca: string;
  onEscolher: (d: DialogoTelegram) => void;
}) {
  if (erro) return <p className="mt-3 text-sm text-amber-200">{erro}</p>;
  if (!dialogos) return <p className="mt-3 text-sm text-neutral-500">Carregando seus grupos…</p>;
  const termo = semAcento(busca.trim());
  const itens = termo ? dialogos.filter((d) => semAcento(d.titulo).includes(termo)) : dialogos;
  if (!itens.length) {
    return <p className="mt-3 text-sm text-neutral-500">{termo ? 'Nenhum grupo com esse nome.' : 'Você não está em nenhum grupo ou canal.'}</p>;
  }
  return (
    <ul className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-neutral-800/60 p-1" aria-label="Seus grupos, canais e bots">
      {itens.map((d) => (
        <li key={d.chave}>
          <button
            type="button"
            onClick={() => onEscolher(d)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-neutral-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-700 text-sm font-medium text-neutral-200">
              {d.titulo.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-100">{d.titulo || 'Sem nome'}</span>
              <span className="block text-xs text-neutral-400">
                {[
                  TIPO_DIALOGO[d.tipo],
                  d.membros !== null && d.tipo !== 'bot' ? plural(d.membros, d.tipo === 'canal' ? 'inscrito' : 'membro', d.tipo === 'canal' ? 'inscritos' : 'membros') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {d.cursoId && <span className="shrink-0 text-xs text-blue-400">Na biblioteca</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CartaoPrevia({ previa, semVideos }: { previa: PreviaTelegram; semVideos: boolean }) {
  const linhas = [
    previa.bot ? 'Bot' : previa.canal ? 'Canal' : 'Grupo',
    !previa.bot && previa.membros !== null ? plural(previa.membros, previa.canal ? 'inscrito' : 'membro', previa.canal ? 'inscritos' : 'membros') : null,
  ].filter(Boolean);
  const conteudo =
    previa.videos !== null
      ? [plural(previa.videos, 'vídeo', 'vídeos'), previa.fotos ? plural(previa.fotos, 'foto', 'fotos') : null, previa.arquivos ? plural(previa.arquivos, 'arquivo', 'arquivos') : null].filter(Boolean).join(' · ')
      : null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg bg-neutral-800 p-3">
      {previa.foto ? (
        <img src={previa.foto} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <div aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-neutral-700 text-lg font-medium text-neutral-200">
          {previa.titulo.trim().charAt(0).toUpperCase() || '?'}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium text-neutral-100">{previa.titulo || 'Sem nome'}</div>
        <div className="text-sm text-neutral-400">{linhas.join(' · ')}</div>
        {previa.convite ? (
          <div className="text-sm text-neutral-400">Você ainda não está neste grupo.</div>
        ) : semVideos ? (
          <div className="text-sm text-amber-200">Não achei vídeos neste grupo.</div>
        ) : (
          conteudo && <div className="text-sm text-neutral-400">{conteudo}</div>
        )}
        {previa.cursoId && <div className="text-sm text-blue-400">Já está na sua biblioteca.</div>}
      </div>
    </div>
  );
}
