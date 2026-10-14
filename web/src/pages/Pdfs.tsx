import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Documento } from '../api/client';
import AbasPrincipais from '../components/AbasPrincipais';
import { FileText, Plus, Settings as SettingsIcon, Check } from '../components/icons';
import { escolherPasta, escolherPdfs } from '../lib/desktop';
import { gerarCapa } from '../lib/pdf';

// A estante de PDFs: livros, questões, apostilas. Cada PDF é um arquivo do disco
// que o app só lê; a página onde a pessoa parou vai com a conta.

const chip = (ativo: boolean) =>
  `min-h-[44px] rounded-full px-4 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
    ativo ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
  }`;
const itemMenu = 'block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-neutral-800';
const campo =
  'min-h-[44px] w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600';

const SEM_CATEGORIA = '__sem__';

function progresso(d: Documento): number {
  if (d.lido) return 100;
  if (!d.paginas || !d.leituraEm) return 0;
  return Math.round((d.pagina / d.paginas) * 100);
}

export default function Pdfs() {
  const qc = useQueryClient();
  const { data: docs, isLoading } = useQuery({ queryKey: ['documentos'], queryFn: api.listarDocumentos });
  const [filtro, setFiltro] = useState<string | null>(null);
  const [menuAdicionar, setMenuAdicionar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedindoCategoria, setPedindoCategoria] = useState<{ caminhos?: string[]; pasta?: string } | null>(null);
  const [acoes, setAcoes] = useState<Documento | null>(null);

  const categorias = useMemo(
    () => [...new Set((docs ?? []).map((d) => d.categoria).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [docs],
  );
  const semCategoria = (docs ?? []).some((d) => !d.categoria);
  const visiveis = (docs ?? []).filter((d) =>
    filtro === null ? true : filtro === SEM_CATEGORIA ? !d.categoria : d.categoria === filtro,
  );
  // O filtro some quando a última da categoria sai dela.
  useEffect(() => {
    if (filtro && filtro !== SEM_CATEGORIA && !categorias.includes(filtro)) setFiltro(null);
  }, [categorias, filtro]);

  // Capa e número de páginas saem do próprio PDF, desenhados aqui (um de cada vez).
  useEffect(() => {
    const faltando = (docs ?? []).filter((d) => d.disponivel && (!d.temCapa || !d.paginas));
    if (!faltando.length) return;
    let vivo = true;
    void (async () => {
      for (const d of faltando) {
        if (!vivo) return;
        try {
          await gerarCapa(d.id);
        } catch {
          // PDF protegido ou corrompido: fica sem capa; abrir mostra o motivo.
        }
      }
      if (vivo) void qc.invalidateQueries({ queryKey: ['documentos'] });
    })();
    return () => {
      vivo = false;
    };
    // Só quando muda o conjunto de ids sem capa, não a cada refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(docs ?? []).filter((d) => d.disponivel && (!d.temCapa || !d.paginas)).map((d) => d.id).join()]);

  const adicionar = useMutation({
    mutationFn: api.adicionarPdfs,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['documentos'] });
      const partes = [`${r.criados} PDF${r.criados === 1 ? '' : 's'} adicionado${r.criados === 1 ? '' : 's'}`];
      if (r.jaExistiam) partes.push(`${r.jaExistiam} já estava${r.jaExistiam === 1 ? '' : 'm'} aqui`);
      if (r.recusados) partes.push(`${r.recusados} fora das pastas permitidas ou ilegíve${r.recusados === 1 ? 'l' : 'is'}`);
      setAviso(r.criados === 0 && !r.jaExistiam && !r.recusados ? 'Nenhum PDF encontrado nessa pasta.' : partes.join(' · '));
    },
    onError: (e) => setAviso(e instanceof Error && e.message === 'forbidden' ? 'Essa pasta está fora das pastas permitidas (Configurações).' : 'Não deu para adicionar.'),
  });

  async function escolher(tipo: 'arquivos' | 'pasta') {
    setMenuAdicionar(false);
    setAviso(null);
    if (tipo === 'arquivos') {
      const caminhos = await escolherPdfs('Escolha um ou mais PDFs');
      if (caminhos.length) setPedindoCategoria({ caminhos });
    } else {
      const pasta = await escolherPasta('Escolha a pasta com os PDFs');
      if (pasta) setPedindoCategoria({ pasta });
    }
  }

  const botaoAdicionar = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuAdicionar((v) => !v)}
        aria-expanded={menuAdicionar}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors motion-reduce:transition-none hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <Plus size={18} /> Adicionar
      </button>
      {menuAdicionar && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuAdicionar(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 text-left">
            <button type="button" className="block w-full px-3 py-2.5 text-left text-sm hover:bg-neutral-800" onClick={() => void escolher('arquivos')}>
              Arquivos PDF…
              <div className="text-xs text-neutral-500">Um ou vários</div>
            </button>
            <button type="button" className="block w-full px-3 py-2.5 text-left text-sm hover:bg-neutral-800" onClick={() => void escolher('pasta')}>
              Pasta…
              <div className="text-xs text-neutral-500">Todos os PDFs dentro dela, subpastas inclusive</div>
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="sr-only">PDFs</h1>
          <AbasPrincipais />
          {docs && docs.length > 0 && (
            <p className="mt-1 text-sm text-neutral-500">
              {docs.length} PDF{docs.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            aria-label="Configurações"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          >
            <SettingsIcon size={18} />
          </Link>
          {botaoAdicionar}
        </div>
      </header>

      {aviso && (
        <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          <span>{adicionar.isPending ? 'Adicionando…' : aviso}</span>
          <button type="button" className="text-neutral-500 hover:text-neutral-300" onClick={() => setAviso(null)}>
            Fechar
          </button>
        </div>
      )}

      {categorias.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Categorias">
          <button type="button" className={chip(filtro === null)} aria-pressed={filtro === null} onClick={() => setFiltro(null)}>
            Todas
          </button>
          {categorias.map((c) => (
            <button key={c} type="button" className={chip(filtro === c)} aria-pressed={filtro === c} onClick={() => setFiltro(c)}>
              {c}
            </button>
          ))}
          {semCategoria && (
            <button type="button" className={chip(filtro === SEM_CATEGORIA)} aria-pressed={filtro === SEM_CATEGORIA} onClick={() => setFiltro(SEM_CATEGORIA)}>
              Sem categoria
            </button>
          )}
        </div>
      )}

      {isLoading && <p className="text-sm text-neutral-500">Carregando…</p>}

      {docs && docs.length === 0 && (
        <div className="grid place-items-center rounded-xl border border-neutral-800 px-6 py-16 text-center">
          <FileText size={40} className="text-neutral-600" />
          <h2 className="mt-4 text-lg font-medium text-neutral-200">Nenhum PDF ainda</h2>
          <p className="mt-1 max-w-sm text-sm text-neutral-400">
            Livros, listas de questões, apostilas. O app lê o arquivo onde ele está e lembra a página onde você parou.
          </p>
          <div className="mt-5">{botaoAdicionar}</div>
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {visiveis.map((d) => (
            <CartaoPdf key={d.id} d={d} onAcoes={() => setAcoes(d)} />
          ))}
        </div>
      )}

      {pedindoCategoria && (
        <DialogoCategoria
          titulo="Em qual categoria?"
          categorias={categorias}
          inicial={filtro && filtro !== SEM_CATEGORIA ? filtro : ''}
          confirmar="Adicionar"
          onCancelar={() => setPedindoCategoria(null)}
          onConfirmar={(categoria) => {
            const alvo = pedindoCategoria;
            setPedindoCategoria(null);
            setAviso('Adicionando…');
            adicionar.mutate({ ...alvo, categoria: categoria || null });
          }}
        />
      )}

      {acoes && <AcoesPdf d={acoes} categorias={categorias} onFechar={() => setAcoes(null)} />}
    </div>
  );
}

function CartaoPdf({ d, onAcoes }: { d: Documento; onAcoes: () => void }) {
  const pct = progresso(d);
  return (
    <div className="group relative">
      <Link
        to={`/pdf/${d.id}`}
        className="relative block aspect-[3/4] overflow-hidden rounded-lg bg-neutral-900 outline-none ring-offset-2 ring-offset-neutral-950 transition-shadow motion-reduce:transition-none hover:ring-2 hover:ring-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <div className="absolute inset-0 grid place-items-center text-neutral-700">
          <FileText size={36} />
        </div>
        {d.temCapa && (
          <img
            src={api.documentoCapaUrl(d.id, d.paginas ? String(d.paginas) : undefined)}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full bg-white object-cover object-top"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
        )}
        {!d.disponivel && (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 px-2 py-1.5 text-center text-xs text-amber-300">Arquivo não encontrado</div>
        )}
        {d.lido && (
          <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-green-600 text-white" title="Lido">
            <Check size={14} />
          </span>
        )}
        {pct > 0 && pct < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </Link>
      <button
        type="button"
        aria-label={`Ações de ${d.titulo}`}
        onClick={onAcoes}
        className="absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-lg bg-black/60 text-neutral-200 opacity-100 transition-opacity hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 motion-reduce:transition-none"
      >
        ⋯
      </button>
      <div className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-neutral-100" title={d.titulo}>
        {d.titulo}
      </div>
      <div className="mt-0.5 text-xs text-neutral-400">
        {d.lido ? (
          <span className="text-green-400">✓ Lido</span>
        ) : d.leituraEm && d.paginas ? (
          `p. ${d.pagina} de ${d.paginas}`
        ) : d.paginas ? (
          `${d.paginas} páginas`
        ) : (
          ' '
        )}
        {d.categoria && <span className="text-neutral-500"> · {d.categoria}</span>}
      </div>
    </div>
  );
}

function DialogoCategoria({
  titulo,
  categorias,
  inicial,
  confirmar,
  onCancelar,
  onConfirmar,
}: {
  titulo: string;
  categorias: string[];
  inicial: string;
  confirmar: string;
  onCancelar: () => void;
  onConfirmar: (categoria: string) => void;
}) {
  const [valor, setValor] = useState(inicial);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onCancelar}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-sm rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancelar()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirmar(valor.trim());
        }}
      >
        <h2 className="font-medium text-neutral-100">{titulo}</h2>
        <p className="mt-1 text-sm text-neutral-400">Livros, Questões, Apostilas… Vira um filtro da estante. Pode ficar em branco.</p>
        {categorias.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {categorias.map((c) => (
              <button key={c} type="button" className={chip(valor === c)} onClick={() => setValor(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <input
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Nova categoria"
          maxLength={60}
          autoComplete="off"
          className={`${campo} mt-3`}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="min-h-[44px] px-3 text-sm text-neutral-400 hover:text-neutral-200" onClick={onCancelar}>
            Cancelar
          </button>
          <button type="submit" className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500">
            {confirmar}
          </button>
        </div>
      </form>
    </div>
  );
}

function AcoesPdf({ d, categorias, onFechar }: { d: Documento; categorias: string[]; onFechar: () => void }) {
  const qc = useQueryClient();
  const [fluxo, setFluxo] = useState<'menu' | 'renomear' | 'categoria' | 'remover'>('menu');
  const [titulo, setTitulo] = useState(d.titulo);
  const [erro, setErro] = useState<string | null>(null);
  const depois = () => {
    void qc.invalidateQueries({ queryKey: ['documentos'] });
    onFechar();
  };
  const editar = useMutation({
    mutationFn: (b: Parameters<typeof api.editarDocumento>[1]) => api.editarDocumento(d.id, b),
    onSuccess: depois,
  });

  async function reapontar() {
    const [caminho] = await escolherPdfs(`Onde está "${d.titulo}"?`, false);
    if (!caminho) return;
    try {
      await api.reapontarDocumento(d.id, caminho);
      depois();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErro(m === 'ja-adicionado' ? 'Esse arquivo já é outro PDF da estante.' : m === 'forbidden' ? 'Esse arquivo está fora das pastas permitidas.' : 'Não deu para usar esse arquivo.');
    }
  }

  if (fluxo === 'categoria') {
    return (
      <DialogoCategoria
        titulo="Categoria"
        categorias={categorias}
        inicial={d.categoria ?? ''}
        confirmar="Salvar"
        onCancelar={onFechar}
        onConfirmar={(categoria) => editar.mutate({ categoria: categoria || null })}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.titulo}
        className="w-full max-w-xs rounded-xl bg-neutral-900 p-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onFechar()}
      >
        <div className="truncate px-3 pb-2 pt-2 text-sm font-medium text-neutral-200">{d.titulo}</div>
        {fluxo === 'menu' && (
          <>
            <button type="button" autoFocus className={itemMenu} onClick={() => setFluxo('renomear')}>
              Renomear…
            </button>
            <button type="button" className={itemMenu} onClick={() => setFluxo('categoria')}>
              Categoria…
            </button>
            <button type="button" className={itemMenu} onClick={() => editar.mutate({ lido: !d.lido })}>
              {d.lido ? 'Marcar como não lido' : 'Marcar como lido'}
            </button>
            <button type="button" className={itemMenu} onClick={() => void reapontar()}>
              Re-apontar arquivo…
            </button>
            <button type="button" className={`${itemMenu} text-red-400`} onClick={() => setFluxo('remover')}>
              Remover da estante…
            </button>
            {erro && <p className="px-3 py-2 text-xs text-amber-300">{erro}</p>}
          </>
        )}
        {fluxo === 'renomear' && (
          <form
            className="p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (titulo.trim()) editar.mutate({ titulo: titulo.trim() });
            }}
          >
            <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={300} className={campo} />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="min-h-[44px] px-3 text-sm text-neutral-400" onClick={() => setFluxo('menu')}>
                Voltar
              </button>
              <button type="submit" className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500">
                Salvar
              </button>
            </div>
          </form>
        )}
        {fluxo === 'remover' && (
          <div className="p-2">
            <p className="text-sm text-neutral-300">Sai da estante e a leitura é esquecida. O arquivo continua no disco.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="min-h-[44px] px-3 text-sm text-neutral-400" onClick={() => setFluxo('menu')}>
                Voltar
              </button>
              <button
                type="button"
                autoFocus
                className="min-h-[44px] rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500"
                onClick={() => void api.removerDocumento(d.id).then(depois)}
              >
                Remover
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
