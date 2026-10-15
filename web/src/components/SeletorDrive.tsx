import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type ItemDrive, type ResultadoAdicionarPdfs } from '../api/client';
import { autorizarNoGoogle, mensagemErroDrive } from '../api/driveAuth';
import { abrirFora } from '../lib/desktop';
import { Check, ChevronRight, FileText } from './icons';

// `modo="curso"`: a mesma navegação escolhe a pasta de um curso (só pastas aparecem).
// Escolher PDFs (ou uma pasta inteira) navegando no próprio Google Drive, em vez
// de copiar e colar um link. O Google Picker oficial não serve aqui: ele roda
// dentro de páginas do Google, e o login do Google é recusado na webview do app.
// Por isso a listagem vem da Drive API pelo servidor, com a conta já conectada.

type Raiz = 'root' | 'compartilhados';
interface Nivel {
  id: string;
  nome: string;
  resourceKey: string | null;
}

const linkDe = (i: { id: string; tipo: 'pasta' | 'pdf'; resourceKey: string | null }) => {
  const base = i.tipo === 'pasta' ? `https://drive.google.com/drive/folders/${i.id}` : `https://drive.google.com/file/d/${i.id}/view`;
  return i.resourceKey ? `${base}?resourcekey=${encodeURIComponent(i.resourceKey)}` : base;
};

export default function SeletorDrive({
  modo = 'pdfs',
  categoriaId,
  onClose,
  onColarLink,
  aoAdicionar,
}: {
  modo?: 'pdfs' | 'curso';
  categoriaId?: string;
  onClose: () => void;
  /** Para o que não aparece na lista (link de outra pessoa que não foi aberto): o diálogo do link. */
  onColarLink: () => void;
  aoAdicionar?: (r: ResultadoAdicionarPdfs) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [raiz, setRaiz] = useState<Raiz>('root');
  const [trilha, setTrilha] = useState<Nivel[]>([]);
  const [itens, setItens] = useState<ItemDrive[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [urlAuth, setUrlAuth] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Map<string, ItemDrive>>(new Map());
  const [adicionando, setAdicionando] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const atual = trilha[trilha.length - 1];
  const pasta = atual?.id ?? raiz;

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    let vivo = true;
    setItens(null);
    setErro(null);
    void api.driveNavegar(pasta).then(async (r) => {
      if (!vivo) return;
      if (r.tipo === 'itens') return setItens(modo === 'curso' ? r.itens.filter((i) => i.tipo === 'pasta') : r.itens);
      if (r.tipo === 'erro') return setErro(mensagemErroDrive(r.erro));
      // Sem conta Google conectada: conecta e lista de novo.
      const ctrl = new AbortController();
      abort.current = ctrl;
      setUrlAuth(r.url);
      const ok = await autorizarNoGoogle(r.url, { signal: ctrl.signal });
      if (!vivo || ctrl.signal.aborted) return;
      setUrlAuth(null);
      if (ok) setTentativa((t) => t + 1);
      else setErro('A autorização do Google não foi concluída.');
    });
    return () => {
      vivo = false;
    };
  }, [pasta, tentativa, modo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  function alternar(i: ItemDrive) {
    setMarcados((m) => {
      const n = new Map(m);
      if (n.has(i.id)) n.delete(i.id);
      else n.set(i.id, i);
      return n;
    });
  }

  async function adicionar(alvos: Array<{ id: string; tipo: 'pasta' | 'pdf'; resourceKey: string | null }>) {
    setAdicionando(true);
    setErro(null);
    const total: ResultadoAdicionarPdfs = { criados: 0, jaExistiam: 0, recusados: 0, ids: [] };
    for (const a of alvos) {
      const r = await api.adicionarPdfsDoDrive(linkDe(a), categoriaId);
      if (r.tipo === 'pdfs') {
        total.criados += r.resultado.criados;
        total.jaExistiam += r.resultado.jaExistiam;
        total.ids.push(...r.resultado.ids);
      } else if (r.tipo === 'erro') {
        setErro(mensagemErroDrive(r.erro));
        setAdicionando(false);
        return;
      }
    }
    aoAdicionar?.(total);
    onClose();
  }

  // Curso: a pasta escolhida vira o curso, como colar o link dela.
  async function usarPasta(n: Nivel) {
    setAdicionando(true);
    setErro(null);
    const r = await api.driveCriarCurso(linkDe({ id: n.id, tipo: 'pasta', resourceKey: n.resourceKey }));
    if (r.tipo === 'criado') {
      if (categoriaId) await api.patchCourse(r.id, { collectionId: categoriaId }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['courses'] });
      onClose();
      navigate(`/course/${r.id}`);
      return;
    }
    setErro(r.tipo === 'erro' ? mensagemErroDrive(r.erro) : 'A autorização do Google expirou.');
    setAdicionando(false);
  }

  const aba = (ativo: boolean) =>
    `min-h-[40px] rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
      ativo ? 'bg-neutral-700 text-white' : 'text-neutral-300 hover:bg-neutral-800'
    }`;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Escolher do Google Drive"
        className="flex h-[min(640px,85dvh)] w-full max-w-xl flex-col rounded-xl bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-800 p-4">
          <div className="font-medium text-neutral-100">{modo === 'curso' ? 'Curso do Google Drive' : 'Do Google Drive'}</div>
          {modo === 'curso' && <p className="mt-1 text-xs text-neutral-500">Entre na pasta do curso e use “Usar esta pasta”.</p>}
          <div className="mt-3 flex gap-1">
            {(['root', 'compartilhados'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={aba(raiz === r)}
                onClick={() => {
                  setRaiz(r);
                  setTrilha([]);
                }}
              >
                {r === 'root' ? 'Meu Drive' : 'Compartilhados comigo'}
              </button>
            ))}
          </div>
          {trilha.length > 0 && (
            <nav aria-label="Pastas" className="mt-3 flex flex-wrap items-center gap-1 text-sm text-neutral-400">
              <button type="button" className="rounded px-1 hover:text-neutral-100" onClick={() => setTrilha([])}>
                {raiz === 'root' ? 'Meu Drive' : 'Compartilhados'}
              </button>
              {trilha.map((n, i) => (
                <span key={n.id} className="flex items-center gap-1">
                  <ChevronRight size={14} />
                  <button
                    type="button"
                    className={`rounded px-1 ${i === trilha.length - 1 ? 'text-neutral-100' : 'hover:text-neutral-100'}`}
                    onClick={() => setTrilha(trilha.slice(0, i + 1))}
                  >
                    {n.nome}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {urlAuth ? (
            <p className="p-4 text-sm text-neutral-300" role="status">
              Conecte sua conta Google no navegador que abriu.{' '}
              <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => void abrirFora(urlAuth)}>
                Abrir de novo
              </button>
            </p>
          ) : erro ? (
            <p role="alert" className="p-4 text-sm text-amber-200">
              {erro}
            </p>
          ) : !itens ? (
            <p className="p-4 text-sm text-neutral-500">Carregando…</p>
          ) : itens.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">{modo === 'curso' ? 'Nenhuma pasta aqui.' : 'Nenhum PDF nem pasta aqui.'}</p>
          ) : (
            <ul>
              {itens.map((i) => (
                <li key={i.id}>
                  {i.tipo === 'pasta' ? (
                    <button
                      type="button"
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      onClick={() => setTrilha([...trilha, { id: i.id, nome: i.nome, resourceKey: i.resourceKey }])}
                    >
                      <span aria-hidden>📁</span>
                      <span className="min-w-0 flex-1 truncate">{i.nome}</span>
                      <ChevronRight size={16} className="text-neutral-500" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={marcados.has(i.id)}
                      className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        marcados.has(i.id) ? 'text-white' : 'text-neutral-300'
                      }`}
                      onClick={() => alternar(i)}
                    >
                      <span
                        aria-hidden
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
                          marcados.has(i.id) ? 'border-blue-500 bg-blue-600 text-white' : 'border-neutral-600 text-transparent'
                        }`}
                      >
                        <Check size={14} />
                      </span>
                      <FileText size={16} className="shrink-0 text-neutral-500" />
                      <span className="min-w-0 flex-1 truncate">{i.nome}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 p-4">
          <button type="button" className="text-sm text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline" onClick={onColarLink}>
            Colar um link
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {modo === 'curso' ? (
              <button
                type="button"
                disabled={adicionando || !atual}
                className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                onClick={() => atual && void usarPasta(atual)}
              >
                {adicionando ? 'Abrindo a pasta…' : 'Usar esta pasta'}
              </button>
            ) : (
              <>
                {atual && (
                  <button
                    type="button"
                    disabled={adicionando}
                    className="min-h-[44px] rounded-lg bg-neutral-800 px-3 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
                    onClick={() => void adicionar([{ id: atual.id, tipo: 'pasta', resourceKey: atual.resourceKey }])}
                    title="Todos os PDFs desta pasta, subpastas inclusive"
                  >
                    Adicionar esta pasta
                  </button>
                )}
                <button
                  type="button"
                  disabled={adicionando || marcados.size === 0}
                  className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  onClick={() => void adicionar([...marcados.values()])}
                >
                  {adicionando ? 'Adicionando…' : marcados.size ? `Adicionar ${marcados.size} PDF${marcados.size === 1 ? '' : 's'}` : 'Adicionar'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
