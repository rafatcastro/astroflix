import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Documento, type ResultadoAdicionarPdfs } from '../api/client';
import DriveLinkModal from '../components/DriveLinkModal';
import SeletorDrive from '../components/SeletorDrive';
import MenuAdicionar from '../components/MenuAdicionar';
import CabecalhoCategoria, { SEM } from '../components/CabecalhoCategoria';
import { useCollections, useConexaoDrive } from '../api/hooks';
import { FileText, Settings as SettingsIcon, Check } from '../components/icons';
import { escolherPasta, escolherPdfs } from '../lib/desktop';
import { gerarCapa } from '../lib/pdf';

// A estante de PDFs: livros, questões, apostilas. Cada PDF é um arquivo do disco
// que o app só lê; a página onde a pessoa parou vai com a conta.

const itemMenu = 'block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-neutral-800';
const campo =
  'min-h-[44px] w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600';

function progresso(d: Documento): number {
  if (d.lido) return 100;
  if (!d.paginas || !d.leituraEm) return 0;
  return Math.round((d.pagina / d.paginas) * 100);
}

// A aba PDFs de uma categoria (`categoria` = id ou 'sem').
export default function Pdfs({ categoria }: { categoria: string }) {
  const qc = useQueryClient();
  const { data: docs, isLoading } = useQuery({ queryKey: ['documentos', categoria], queryFn: () => api.listarDocumentos(categoria) });
  const [aviso, setAviso] = useState<string | null>(null);
  const [doDrive, setDoDrive] = useState(false);
  const [seletorDrive, setSeletorDrive] = useState(false);
  const [acoes, setAcoes] = useState<Documento | null>(null);

  // Dentro da categoria não há outra divisão: a estante mostra todos os PDFs dela.
  const visiveis = docs ?? [];

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

  function avisar(r: ResultadoAdicionarPdfs) {
    void qc.invalidateQueries({ queryKey: ['documentos'] });
    const partes = [`${r.criados} PDF${r.criados === 1 ? '' : 's'} adicionado${r.criados === 1 ? '' : 's'}`];
    if (r.jaExistiam) partes.push(`${r.jaExistiam} já estava${r.jaExistiam === 1 ? '' : 'm'} aqui`);
    if (r.recusados) partes.push(`${r.recusados} fora das pastas permitidas ou ilegíve${r.recusados === 1 ? 'l' : 'is'}`);
    setAviso(r.criados === 0 && !r.jaExistiam && !r.recusados ? 'Nenhum PDF encontrado nessa pasta.' : partes.join(' · '));
  }

  const adicionar = useMutation({
    mutationFn: api.adicionarPdfs,
    onSuccess: (r) => avisar(r),
    onError: (e) => setAviso(e instanceof Error && e.message === 'forbidden' ? 'Essa pasta está fora das pastas permitidas (Configurações).' : 'Não deu para adicionar.'),
  });

  function adicionarNaCategoria(alvo: { caminhos?: string[]; pasta?: string }) {
    setAviso('Adicionando…');
    adicionar.mutate({ ...alvo, tipo: null, categoriaId: categoria === SEM ? null : categoria });
  }

  async function escolher(tipo: 'arquivos' | 'pasta') {
    setAviso(null);
    if (tipo === 'arquivos') {
      const caminhos = await escolherPdfs('Escolha um ou mais PDFs');
      if (caminhos.length) adicionarNaCategoria({ caminhos });
    } else {
      const pasta = await escolherPasta('Escolha a pasta com os PDFs');
      if (pasta) adicionarNaCategoria({ pasta });
    }
  }

  const drive = useConexaoDrive();
  const botaoAdicionar = (
    <MenuAdicionar
      opcoes={[
        { rotulo: 'Arquivos PDF…', descricao: 'Um ou vários', onClick: () => void escolher('arquivos') },
        { rotulo: 'Pasta…', descricao: 'Todos os PDFs dentro dela, subpastas inclusive', onClick: () => void escolher('pasta') },
        drive.conectado === false
          ? {
              rotulo: drive.conectando ? 'Esperando o Google…' : 'Conectar o Google Drive',
              descricao: 'Para trazer PDFs do seu Drive',
              onClick: () => void drive.conectar().then((ok) => ok && setSeletorDrive(true)),
            }
          : {
              rotulo: 'Do Google Drive',
              descricao: 'Escolha PDFs ou uma pasta do seu Drive; lidos de lá, sem baixar',
              onClick: () => {
                setAviso(null);
                setSeletorDrive(true);
              },
            },
      ]}
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <CabecalhoCategoria
        cat={categoria}
        info={docs && docs.length > 0 ? `${docs.length} PDF${docs.length === 1 ? '' : 's'}` : undefined}
        acoes={
          <>
            <Link
              to="/settings"
              aria-label="Configurações"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            >
              <SettingsIcon size={18} />
            </Link>
            {botaoAdicionar}
          </>
        }
      />

      {aviso && (
        <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          <span>{adicionar.isPending ? 'Adicionando…' : aviso}</span>
          <button type="button" className="text-neutral-500 hover:text-neutral-300" onClick={() => setAviso(null)}>
            Fechar
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-neutral-500">Carregando…</p>}

      {docs && docs.length === 0 && (
        <div className="grid place-items-center rounded-xl border border-neutral-800 px-6 py-16 text-center">
          <FileText size={40} className="text-neutral-600" />
          <h2 className="mt-4 text-lg font-medium text-neutral-200">Nenhum PDF ainda</h2>
          <p className="mt-1 max-w-sm text-sm text-neutral-400">
            Livros, listas de questões, apostilas. Use Adicionar, no topo; o app lembra a página onde você parou.
          </p>
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="grid gap-x-4 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {visiveis.map((d) => (
            <CartaoPdf key={d.id} d={d} onAcoes={() => setAcoes(d)} />
          ))}
        </div>
      )}

      {doDrive && (
        <DriveLinkModal
          categoriaId={categoria === SEM ? undefined : categoria}
          onClose={() => setDoDrive(false)}
          pdfs={{ aoAdicionar: avisar }}
        />
      )}

      {seletorDrive && (
        <SeletorDrive
          categoriaId={categoria === SEM ? undefined : categoria}
          onClose={() => setSeletorDrive(false)}
          onColarLink={() => {
            setSeletorDrive(false);
            setDoDrive(true);
          }}
          aoAdicionar={avisar}
        />
      )}

      {acoes && <AcoesPdf d={acoes} onFechar={() => setAcoes(null)} />}
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
        {d.origem === 'drive' && <span className="text-neutral-500"> · Drive</span>}
      </div>
    </div>
  );
}

function AcoesPdf({ d, onFechar }: { d: Documento; onFechar: () => void }) {
  const qc = useQueryClient();
  const [fluxo, setFluxo] = useState<'menu' | 'renomear' | 'mover' | 'remover'>('menu');
  const [titulo, setTitulo] = useState(d.titulo);
  const { data: cats } = useCollections();
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
            <button type="button" className={itemMenu} onClick={() => setFluxo('mover')}>
              Mover para categoria…
            </button>
            <button type="button" className={itemMenu} onClick={() => editar.mutate({ lido: !d.lido })}>
              {d.lido ? 'Marcar como não lido' : 'Marcar como lido'}
            </button>
            {d.origem !== 'drive' && (
              <button type="button" className={itemMenu} onClick={() => void reapontar()}>
                Re-apontar arquivo…
              </button>
            )}
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
        {fluxo === 'mover' && (
          <div className="max-h-72 overflow-y-auto">
            {(cats ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${itemMenu}${c.id === d.categoriaId ? ' text-blue-400' : ''}`}
                onClick={() => editar.mutate({ categoriaId: c.id })}
              >
                {c.name}
              </button>
            ))}
            {d.categoriaId && (
              <button type="button" className={itemMenu} onClick={() => editar.mutate({ categoriaId: null })}>
                Sem categoria
              </button>
            )}
            <button type="button" className={`${itemMenu} text-neutral-400`} onClick={() => setFluxo('menu')}>
              Voltar
            </button>
          </div>
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
