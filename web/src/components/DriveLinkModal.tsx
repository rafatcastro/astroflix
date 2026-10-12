import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { autorizarNoGoogle, mensagemErroDrive } from '../api/driveAuth';
import TextField from './TextField';

export default function DriveLinkModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [urlBloqueada, setUrlBloqueada] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Esc fecha e Tab fica preso no diálogo (docs/design.md: teclado em primeiro plano).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const alvos = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'),
      );
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

  const enviar = async () => {
    if (!link.trim() || busy) return;
    setBusy(true);
    setErro(null);
    setUrlBloqueada(null);
    try {
      let res = await api.driveCriarCurso(link.trim());
      if (res.tipo === 'autorizar') {
        const urlAuth = res.url;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const ok = await autorizarNoGoogle(urlAuth, { signal: ctrl.signal, onBloqueado: () => setUrlBloqueada(urlAuth) });
        setUrlBloqueada(null);
        if (ctrl.signal.aborted) return;
        if (!ok) {
          setErro('A autorização do Google não foi concluída.');
          setBusy(false);
          return;
        }
        res = await api.driveCriarCurso(link.trim());
        // Segunda recusa de autorização logo após autorizar: não faz laço, mostra o aviso.
        if (res.tipo === 'autorizar') res = { tipo: 'erro', erro: 'nao-autorizado' };
      }
      if (res.tipo === 'criado') {
        qc.invalidateQueries({ queryKey: ['courses'] });
        navigate(`/course/${res.id}`);
        return;
      }
      if (res.tipo === 'erro') setErro(mensagemErroDrive(res.erro));
    } catch {
      setErro('Sem conexão com o Google Drive.');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-modal-titulo"
        className="w-full max-w-md rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="drive-modal-titulo" className="mb-3 font-medium">Do Google Drive</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <label htmlFor="drive-link" className="mb-1 block text-sm text-neutral-300">
            Link da pasta no Google Drive
          </label>
          <TextField
            id="drive-link"
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'drive-erro' : undefined}
            placeholder="https://drive.google.com/drive/folders/…"
          />
          {erro && (
            <p id="drive-erro" role="alert" className="mt-2 text-sm text-amber-200">
              {erro}
            </p>
          )}
          {urlBloqueada && (
            <p className="mt-2 text-sm text-neutral-300">
              <a href={urlBloqueada} target="_blank" rel="opener" className="underline decoration-neutral-600 underline-offset-2 hover:text-white">
                Abrir a autorização do Google
              </a>
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !link.trim()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
            >
              {busy ? 'Lendo a pasta…' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
