import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import TextField from './TextField';

// Adicionar → "Playlist (pela extensão)": um curso vazio que a extensão do Chrome
// vai enchendo, aula a aula, com o que a pessoa assiste logada no site.
export default function NovaPlaylistModal({ onClose, categoriaId }: { onClose: () => void; categoriaId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const criar = async () => {
    if (!titulo.trim() || enviando) return;
    setEnviando(true);
    try {
      const { id } = await api.linksCriarPlaylist(titulo.trim(), categoriaId);
      qc.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/course/${id}`);
    } catch {
      setErro('Não foi possível criar a playlist.');
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-titulo"
        className="w-full max-w-md rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="playlist-titulo" className="mb-1 font-medium">
          Playlist nova
        </div>
        <p className="mb-3 text-sm text-neutral-400">
          Depois, com a aula aberta no Chrome, clique no ícone do Astroflix e escolha esta playlist. A extensão fica em
          Configurações → Extensão do navegador.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void criar();
          }}
        >
          <label htmlFor="playlist-nome" className="mb-1 block text-sm text-neutral-300">
            Nome
          </label>
          <TextField id="playlist-nome" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Matemática básica" />
          {erro && (
            <p role="alert" className="mt-2 text-sm text-amber-200">
              {erro}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!titulo.trim() || enviando}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
            >
              {enviando ? 'Criando…' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
