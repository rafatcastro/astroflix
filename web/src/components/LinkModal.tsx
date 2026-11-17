import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type DescobertaLinks } from '../api/client';
import { formatDuration } from '../lib/format';
import TextField from './TextField';

// Importar por link: cola o link de uma página (uma playlist do YouTube, a página
// de um curso), o servidor acha os vídeos (abrindo link por link da página, o que
// pode levar um minuto) e a pessoa revisa antes de criar o curso: tira o que não
// é aula, acerta os títulos e o nome do curso. Os vídeos são baixados depois, já
// com o curso aberto (server/src/links/importar.ts).

const ERROS: Record<string, string> = {
  'link-invalido': 'Cole um link que comece com http:// ou https://.',
  'sem-videos': 'Nenhum vídeo nessa página nem nos links dela. Se a página pede login, essa parte ainda não está pronta.',
  'nao-abriu': 'Não foi possível abrir essa página.',
};

const mensagemSemYtDlp = navigator.userAgent.includes('Windows')
  ? 'Para importar por link, instale o yt-dlp (no terminal: winget install yt-dlp) e tente de novo.'
  : 'Para importar por link, instale o yt-dlp (no terminal: brew install yt-dlp) e tente de novo.';

interface Linha {
  url: string;
  titulo: string;
  duracaoSec: number | null;
  marcado: boolean;
}

const hostDe = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export default function LinkModal({ onClose, categoriaId }: { onClose: () => void; categoriaId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [descoberta, setDescoberta] = useState<DescobertaLinks | null>(null);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [titulo, setTitulo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const idRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const lendo = descoberta?.fase === 'lendo';

  // Fechar no meio da leitura para o trabalho no servidor.
  useEffect(
    () => () => {
      if (idRef.current) void api.linksCancelar(idRef.current).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const alvos = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
      if (!alvos.length) return;
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

  // Consulta a leitura até acabar; os vídeos achados vão aparecendo na lista.
  useEffect(() => {
    if (!lendo || !idRef.current) return;
    const id = idRef.current;
    const t = setInterval(async () => {
      try {
        const d = await api.linksDescoberta(id);
        setDescoberta(d);
        aplicar(d);
        if (d.fase !== 'lendo') {
          idRef.current = null;
          if (d.fase === 'erro') setErro(d.erro === 'sem-ytdlp' ? mensagemSemYtDlp : (ERROS[d.erro ?? ''] ?? `A leitura falhou: ${d.erro}`));
        }
      } catch {
        setErro('A leitura da página parou.');
        setDescoberta(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lendo]);

  // Guarda o que a pessoa já mexeu (título, desmarcado) quando chegam vídeos novos.
  const aplicar = (d: DescobertaLinks) => {
    setLinhas((antes) => {
      const porUrl = new Map((antes ?? []).map((l) => [l.url, l]));
      return d.itens.map((v) => porUrl.get(v.url) ?? { ...v, marcado: true });
    });
    setTitulo((t) => t || d.titulo || '');
  };

  const procurar = async () => {
    const l = link.trim();
    if (!l || lendo) return;
    setErro(null);
    setLinhas(null);
    setTitulo('');
    try {
      const { id } = await api.linksDescobrir(l);
      idRef.current = id;
      setDescoberta({ fase: 'lendo', link: l, titulo: null, verificados: 0, total: 0, itens: [], erro: null });
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErro(m === 'sem-ytdlp' ? mensagemSemYtDlp : (ERROS[m] ?? 'Não foi possível ler esse link.'));
    }
  };

  const parar = () => {
    if (idRef.current) void api.linksCancelar(idRef.current).catch(() => undefined);
    idRef.current = null;
    setDescoberta((d) => (d ? { ...d, fase: 'pronto' } : d));
  };

  const marcados = linhas?.filter((l) => l.marcado) ?? [];

  const importar = async () => {
    if (!descoberta || !marcados.length || enviando) return;
    setEnviando(true);
    try {
      const { id } = await api.linksImportar({
        titulo: titulo.trim() || descoberta.titulo || 'Curso',
        link: descoberta.link,
        categoriaId,
        itens: marcados.map((l) => ({ url: l.url, titulo: l.titulo })),
      });
      qc.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/course/${id}`);
    } catch {
      setErro('Não foi possível criar o curso.');
      setEnviando(false);
    }
  };

  const mudar = (i: number, m: Partial<Linha>) => setLinhas((ls) => ls && ls.map((l, j) => (j === i ? { ...l, ...m } : l)));
  const todos = !!linhas?.length && marcados.length === linhas.length;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-titulo"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="link-modal-titulo" className="mb-3 font-medium">
          De um link
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void procurar();
          }}
          className="flex gap-2"
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="link-pagina" className="sr-only">
              Link da página
            </label>
            <TextField
              id="link-pagina"
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={lendo}
              aria-invalid={erro ? true : undefined}
              aria-describedby="link-ajuda"
              placeholder="Playlist do YouTube, página de um curso…"
            />
          </div>
          {lendo ? (
            <button type="button" onClick={parar} className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              Parar
            </button>
          ) : (
            <button
              type="submit"
              disabled={!link.trim()}
              className="rounded-lg bg-neutral-700 px-3 py-2 text-sm text-neutral-50 hover:bg-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
            >
              Procurar vídeos
            </button>
          )}
        </form>
        <p id="link-ajuda" className="mt-2 text-xs text-neutral-500">
          O app abre a página e cada link dela e fica com os que têm vídeo. Os vídeos são baixados para tocarem aqui.
        </p>

        {erro && (
          <p role="alert" className="mt-3 text-sm text-amber-200">
            {erro}
          </p>
        )}

        {descoberta && (
          <p role="status" className="mt-3 text-sm text-neutral-300">
            {lendo
              ? descoberta.total
                ? `Abrindo os links da página: ${descoberta.verificados} de ${descoberta.total}. ${linhas?.length ?? 0} vídeo(s) até agora.`
                : 'Lendo a página…'
              : linhas?.length
                ? `${linhas.length} vídeo(s) achado(s). Desmarque o que não for aula e acerte os títulos.`
                : null}
          </p>
        )}

        {!!linhas?.length && (
          <>
            <label htmlFor="link-curso" className="mb-1 mt-4 block text-sm text-neutral-300">
              Nome do curso
            </label>
            <TextField id="link-curso" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            <div className="mt-3 flex items-center justify-between text-sm text-neutral-300">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={todos} onChange={() => setLinhas((ls) => ls && ls.map((l) => ({ ...l, marcado: !todos })))} />
                Todos
              </label>
              <span>
                {marcados.length} de {linhas.length}
              </span>
            </div>
            <ol className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {linhas.map((l, i) => (
                <li key={l.url} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${l.marcado ? '' : 'opacity-50'}`}>
                  <input type="checkbox" checked={l.marcado} onChange={() => mudar(i, { marcado: !l.marcado })} aria-label={`Importar ${l.titulo}`} />
                  <span className="w-7 shrink-0 text-right text-xs tabular-nums text-neutral-500">{i + 1}</span>
                  <input
                    value={l.titulo}
                    onChange={(e) => mudar(i, { titulo: e.target.value })}
                    aria-label={`Título do vídeo ${i + 1}`}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-neutral-100 hover:border-neutral-700 focus:border-neutral-600 focus:outline-none"
                  />
                  <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline" title={l.url}>
                    {hostDe(l.url)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-500">{l.duracaoSec ? formatDuration(l.duracaoSec) : ''}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void importar()}
            disabled={!marcados.length || enviando}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            {enviando ? 'Criando…' : marcados.length ? `Importar ${marcados.length} vídeo(s)` : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
