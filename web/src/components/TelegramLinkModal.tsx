import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type RespostaTelegram } from '../api/client';
import { mensagemErroTelegram } from '../api/telegramTextos';
import TelegramLogin from './TelegramLogin';
import TextField from './TextField';
import EmDesenvolvimento from './EmDesenvolvimento';

type Fase = { tipo: 'link' } | { tipo: 'login' } | { tipo: 'convite'; titulo: string };

const botaoPrimario =
  'min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40';
const botaoSecundario =
  'min-h-[44px] rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

/**
 * Colar o link de um grupo do Telegram e virar curso. Sem conta conectada, o
 * login por QR aparece no meio do caminho e, ao concluir, o link é lido de novo
 * sozinho. `soLogin` usa o mesmo diálogo só para conectar (Configurações, player).
 */
export default function TelegramLinkModal({ onClose, soLogin, onConectado }: {
  onClose: () => void;
  soLogin?: boolean;
  onConectado?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [fase, setFase] = useState<Fase>(soLogin ? { tipo: 'login' } : { tipo: 'link' });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
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

  const tratar = (res: RespostaTelegram) => {
    if (res.tipo === 'criado') {
      qc.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/course/${res.id}`);
      onClose();
      return;
    }
    if (res.tipo === 'conectar') setFase({ tipo: 'login' });
    else if (res.tipo === 'convite') setFase({ tipo: 'convite', titulo: res.titulo });
    else setErro(mensagemErroTelegram(res.erro, res.esperaSeg));
  };

  const enviar = async () => {
    if (!link.trim() || busy) return;
    setBusy(true);
    setErro(null);
    tratar(await api.telegramCriarCurso(link.trim()));
    setBusy(false);
  };

  const entrar = async () => {
    setBusy(true);
    setErro(null);
    const res = await api.telegramEntrarConvite(link.trim());
    if (res.tipo === 'erro') setFase({ tipo: 'link' });
    tratar(res);
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
    void enviar();
  };

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
        <div id="tg-modal-titulo" className="mb-3 font-medium">{titulo}<EmDesenvolvimento /></div>

        {fase.tipo === 'login' && (
          <>
            <p className="mb-4 text-sm text-neutral-400">
              O Learnflix abre os grupos com a sua conta do Telegram. A sessão fica só nesta máquina e aparece como
              “Learnflix” nos seus dispositivos.
            </p>
            <TelegramLogin onConectado={conectou} />
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className={botaoSecundario}>Cancelar</button>
            </div>
          </>
        )}

        {fase.tipo === 'convite' && (
          <>
            <p className="text-sm text-neutral-300">
              Este é um convite para <strong className="text-neutral-100">{fase.titulo || 'um grupo'}</strong>. Entrar no grupo
              com a sua conta para assistir?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFase({ tipo: 'link' })} className={botaoSecundario}>Cancelar</button>
              <button type="button" autoFocus onClick={() => void entrar()} disabled={busy} className={botaoPrimario}>
                {busy ? 'Entrando…' : 'Entrar no grupo'}
              </button>
            </div>
          </>
        )}

        {fase.tipo === 'link' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            <label htmlFor="tg-link" className="mb-1 block text-sm text-neutral-300">
              Link do grupo ou canal no Telegram
            </label>
            <TextField
              id="tg-link"
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={busy}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'tg-erro' : 'tg-dica'}
              placeholder="https://t.me/…"
            />
            {erro ? (
              <p id="tg-erro" role="alert" className="mt-2 text-sm text-amber-200">{erro}</p>
            ) : (
              <p id="tg-dica" className="mt-2 text-sm text-neutral-500">Os vídeos viram aulas na ordem em que foram postados.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={botaoSecundario}>Cancelar</button>
              <button type="submit" disabled={busy || !link.trim()} className={botaoPrimario}>
                {busy ? 'Lendo o grupo…' : 'Adicionar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
