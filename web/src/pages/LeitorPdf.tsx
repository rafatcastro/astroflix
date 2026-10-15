import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { api } from '../api/client';
import { abrirPdf } from '../lib/pdf';
import { ArrowLeft, Cards, Check, ChevronLeft, ChevronRight, Minus, Plus } from '../components/icons';
import { caminhoDaCategoria, ultimaCategoria } from '../components/CabecalhoCategoria';
import { AvisoAnki, CartaoFlashcard, FormFlashcard } from '../components/Flashcards';
import { useFlashcards, useMudarFlashcards } from '../api/hooks';
import { WidgetPomodoro } from '../components/Pomodoro';

// Leitor de PDF: as páginas em rolagem contínua, cada uma desenhada só quando
// chega perto da tela (um livro de mil páginas não pode virar mil canvas), e a
// página onde a pessoa está é salva enquanto ela lê, como a posição do vídeo.

const LARGURA_MAX = 900; // na tela larga, a página na largura toda fica ilegível de tão grande
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const PASSO = 0.15;
const SALVAR_MS = 1200;

export default function LeitorPdf() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: d, error: erroDoc } = useQuery({ queryKey: ['documento', id], queryFn: () => api.documento(id) });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [proporcao, setProporcao] = useState(1.414); // altura/largura da 1ª página, até as outras desenharem
  const [zoom, setZoom] = useState(1);
  const [largura, setLargura] = useState(0);
  const [atual, setAtual] = useState(1);
  const [lido, setLido] = useState(false);
  const rolagem = useRef<HTMLDivElement>(null);
  const paginas = useRef<Array<HTMLDivElement | null>>([]);
  const posicionado = useRef(false);
  // Painel de questões ao lado (tecla C), como o da aula.
  const [painel, setPainel] = useState(() => {
    try {
      return localStorage.getItem('leitorPainel') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('leitorPainel', painel ? '1' : '0');
    } catch {
      /* modo privado */
    }
  }, [painel]);
  const voltar = caminhoDaCategoria(d?.categoriaId ?? (d ? null : ultimaCategoria()), 'pdfs');

  // Abre o arquivo (uma vez por PDF).
  const disponivel = d?.disponivel;
  const origemRef = useRef(d?.origem);
  origemRef.current = d?.origem;
  useEffect(() => {
    if (!disponivel) return;
    let vivo = true;
    let aberto: PDFDocumentProxy | null = null;
    abrirPdf(id)
      .then(async (doc) => {
        aberto = doc;
        if (!vivo) return void doc.destroy();
        const p1 = await doc.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        setProporcao(vp.height / vp.width);
        setPdf(doc);
      })
      .catch((e: unknown) => {
        const nome = (e as { name?: string })?.name;
        setErro(
          nome === 'PasswordException'
            ? 'Este PDF tem senha. Abra-o num leitor que peça a senha.'
            : origemRef.current === 'drive'
              ? 'Não deu para abrir este PDF do Google Drive. Confira a conexão e o acesso ao arquivo (Configurações → Google Drive).'
              : 'Não deu para abrir este PDF. O arquivo pode estar corrompido.',
        );
      });
    return () => {
      vivo = false;
      void aberto?.destroy();
    };
  }, [id, disponivel]);

  useEffect(() => {
    if (d) setLido(d.lido);
  }, [d?.lido]); // eslint-disable-line react-hooks/exhaustive-deps

  // Largura disponível: a página acompanha a janela.
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(el.clientWidth));
    ro.observe(el);
    setLargura(el.clientWidth);
    return () => ro.disconnect();
  }, [pdf]);

  const larguraPagina = Math.max(200, Math.round(Math.min(largura - 32, LARGURA_MAX) * zoom));
  const total = pdf?.numPages ?? d?.paginas ?? 0;

  const irPara = useCallback((n: number, suave = true) => {
    const alvo = paginas.current[n - 1];
    if (alvo && rolagem.current) rolagem.current.scrollTo({ top: alvo.offsetTop - 8, behavior: suave ? 'smooth' : 'auto' });
  }, []);

  // Abre onde parou, quando as páginas já têm altura.
  useEffect(() => {
    if (!pdf || !d || !largura || posicionado.current) return;
    posicionado.current = true;
    if (!d.paginas || d.paginas !== pdf.numPages) void api.editarDocumento(id, { paginas: pdf.numPages });
    const n = Math.min(d.pagina, pdf.numPages);
    setAtual(n);
    requestAnimationFrame(() => irPara(n, false));
  }, [pdf, d, largura, id, irPara]);

  // Zoom mantém a página atual na tela.
  const atualRef = useRef(atual);
  atualRef.current = atual;
  useEffect(() => {
    if (posicionado.current) requestAnimationFrame(() => irPara(atualRef.current, false));
  }, [zoom, irPara]);

  // Página atual = a que ocupa o meio da tela.
  useEffect(() => {
    const el = rolagem.current;
    if (!el || !pdf) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const meio = el.scrollTop + el.clientHeight / 2;
      let n = 1;
      for (let i = 0; i < paginas.current.length; i++) {
        const p = paginas.current[i];
        if (p && p.offsetTop <= meio) n = i + 1;
        else break;
      }
      setAtual(n);
    };
    const aoRolar = () => {
      if (!quadro) quadro = requestAnimationFrame(medir);
    };
    el.addEventListener('scroll', aoRolar, { passive: true });
    return () => {
      el.removeEventListener('scroll', aoRolar);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, [pdf]);

  // Salva a página (com folga, para não escrever a cada rolagem), e ao sair.
  const salva = useRef<number | null>(null);
  useEffect(() => {
    if (!posicionado.current || !pdf) return;
    const t = window.setTimeout(() => {
      if (salva.current === atual) return;
      salva.current = atual;
      void api.editarDocumento(id, { pagina: atual }).then((novo) => {
        setLido(novo.lido);
        qc.setQueryData(['documento', id], novo);
        void qc.invalidateQueries({ queryKey: ['documentos'] });
      });
    }, SALVAR_MS);
    return () => window.clearTimeout(t);
  }, [atual, pdf, id, qc]);

  async function alternarLido() {
    const novo = await api.editarDocumento(id, { lido: !lido });
    setLido(novo.lido);
    qc.setQueryData(['documento', id], novo);
    void qc.invalidateQueries({ queryKey: ['documentos'] });
  }

  // Teclado: ←/→ (e PageUp/PageDown já rolam) trocam de página, +/− zoom, Esc volta.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') irPara(Math.min(total, atualRef.current + 1));
      else if (e.key === 'ArrowLeft') irPara(Math.max(1, atualRef.current - 1));
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(ZOOM_MAX, +(z + PASSO).toFixed(2)));
      else if (e.key === '-') setZoom((z) => Math.max(ZOOM_MIN, +(z - PASSO).toFixed(2)));
      else if (e.key === '0') setZoom(1);
      else if (e.key === 'c' || e.key === 'C') setPainel((v) => !v);
      else if (e.key === 'Escape') navigate(voltar);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [irPara, total, navigate, voltar]);

  const botao =
    'grid h-10 w-10 place-items-center rounded-lg text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none';

  const problema =
    erroDoc ? 'Este PDF não está mais na estante.' : d && !d.disponivel ? 'Arquivo não encontrado nesta máquina. Use ⋯ → Re-apontar arquivo… na estante.' : erro;

  return (
    <div className="flex h-dvh flex-col bg-neutral-950">
      <WidgetPomodoro variante="flutuante" />
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <Link to={voltar} aria-label="Voltar para os PDFs" title="Voltar (Esc)" className={botao}>
          <ArrowLeft size={18} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100" title={d?.titulo}>
          {d?.titulo ?? ''}
        </h1>
        {pdf && (
          <>
            <div className="flex items-center gap-1">
              <button type="button" className={botao} aria-label="Página anterior (←)" disabled={atual <= 1} onClick={() => irPara(atual - 1)}>
                <ChevronLeft size={18} />
              </button>
              <CampoPagina atual={atual} total={total} onIr={(n) => irPara(n)} />
              <button type="button" className={botao} aria-label="Próxima página (→)" disabled={atual >= total} onClick={() => irPara(atual + 1)}>
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              <button type="button" className={botao} aria-label="Diminuir (−)" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - PASSO).toFixed(2)))}>
                <Minus size={18} />
              </button>
              <button
                type="button"
                className="min-h-[40px] w-14 rounded-lg text-xs tabular-nums text-neutral-300 hover:bg-neutral-800"
                title="Tamanho padrão (0)"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className={botao} aria-label="Aumentar (+)" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + PASSO).toFixed(2)))}>
                <Plus size={18} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void alternarLido()}
              aria-pressed={lido}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                lido ? 'bg-green-700/30 text-green-300 hover:bg-green-700/40' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <Check size={16} /> {lido ? 'Lido' : 'Marcar como lido'}
            </button>
            <button
              type="button"
              onClick={() => setPainel((v) => !v)}
              aria-pressed={painel}
              title="Questões deste PDF (C)"
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                painel ? 'bg-neutral-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <Cards size={16} /> <span className="hidden md:inline">Questões</span>
            </button>
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
      <div ref={rolagem} className="relative min-w-0 flex-1 overflow-auto">
        {problema ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="text-neutral-300">{problema}</p>
              <Link to={voltar} className="mt-4 inline-block text-sm text-blue-400 hover:text-blue-300">
                Voltar para os PDFs
              </Link>
            </div>
          </div>
        ) : !pdf ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">Abrindo…</div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-4">
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <Pagina
                key={i}
                registrar={(el) => {
                  paginas.current[i] = el;
                }}
                pdf={pdf}
                numero={i + 1}
                largura={larguraPagina}
                proporcao={proporcao}
                raiz={rolagem.current}
              />
            ))}
          </div>
        )}
      </div>
      {painel && pdf && (
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950">
          <PainelQuestoes documentoId={id} pagina={atual} onIrPara={(n) => irPara(n)} />
        </aside>
      )}
      </div>
    </div>
  );
}

// As questões do PDF: o card novo guarda a página em que foi escrito.
function PainelQuestoes({ documentoId, pagina, onIrPara }: { documentoId: string; pagina: number; onIrPara: (n: number) => void }) {
  const { data, isLoading } = useFlashcards({ documentoId });
  const { criar } = useMudarFlashcards();
  return (
    <div className="space-y-3 p-3">
      <FormFlashcard
        rotulo={`Adicionar card (p. ${pagina})`}
        ocupado={criar.isPending}
        onSalvar={(c) => criar.mutateAsync({ ...c, documentoId, pagina })}
      />
      {data?.cards[0] && (
        <p className="text-xs text-neutral-500">
          No Anki: <code>{data.cards[0].baralho}</code>
        </p>
      )}
      <AvisoAnki anki={data?.anki} pendentes={data?.pendentes ?? 0} />
      {isLoading ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : data && data.cards.length > 0 ? (
        <ul className="space-y-2">
          {data.cards.map((c) => (
            <CartaoFlashcard key={c.id} card={c} onIrParaPagina={onIrPara} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">Nenhuma questão deste PDF ainda. O card guarda a página em que você está.</p>
      )}
    </div>
  );
}

function CampoPagina({ atual, total, onIr }: { atual: number; total: number; onIr: (n: number) => void }) {
  const [texto, setTexto] = useState(String(atual));
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    if (!editando) setTexto(String(atual));
  }, [atual, editando]);
  return (
    <form
      className="flex items-center gap-1 text-sm text-neutral-400"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(texto);
        if (Number.isInteger(n) && n >= 1 && n <= total) onIr(n);
        (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur();
      }}
    >
      <span className="hidden sm:inline">p.</span>
      <input
        value={texto}
        inputMode="numeric"
        aria-label="Página"
        onFocus={(e) => {
          setEditando(true);
          e.currentTarget.select();
        }}
        onBlur={() => setEditando(false)}
        onChange={(e) => setTexto(e.target.value.replace(/\D/g, ''))}
        className="h-9 w-12 rounded-md border border-neutral-700 bg-neutral-900 text-center tabular-nums text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600"
      />
      <span className="whitespace-nowrap tabular-nums">de {total}</span>
    </form>
  );
}

// Uma página. Fora da vizinhança da tela, só um retângulo do tamanho certo (a
// rolagem fica estável); perto dela, o canvas desenhado na densidade da tela.
// `registrar` e não `ref`: no React 18, `ref` nunca chega como prop a um componente de função.
const Pagina = ({
  registrar,
  pdf,
  numero,
  largura,
  proporcao,
  raiz,
}: {
  registrar: (el: HTMLDivElement | null) => void;
  pdf: PDFDocumentProxy;
  numero: number;
  largura: number;
  proporcao: number;
  raiz: HTMLElement | null;
}) => {
  const caixa = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [perto, setPerto] = useState(false);
  const [propria, setPropria] = useState<number | null>(null);
  const [desenhou, setDesenhou] = useState(false);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPerto(e.isIntersecting), { root: raiz, rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [raiz]);

  useEffect(() => {
    const c = canvas.current;
    if (!perto || !c) {
      setDesenhou(false);
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      return;
    }
    let tarefa: RenderTask | null = null;
    let vivo = true;
    void pdf.getPage(numero).then((pagina) => {
      if (!vivo) return;
      const base = pagina.getViewport({ scale: 1 });
      setPropria(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp = pagina.getViewport({ scale: (largura / base.width) * dpr });
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      tarefa = pagina.render({ canvas: c, viewport: vp });
      tarefa.promise.then(
        () => vivo && setDesenhou(true),
        () => undefined, // cancelado (rolou para longe ou mudou o zoom)
      );
    });
    return () => {
      vivo = false;
      tarefa?.cancel();
    };
  }, [perto, pdf, numero, largura]);

  const altura = Math.round(largura * (propria ?? proporcao));
  return (
    <div
      ref={(el) => {
        caixa.current = el;
        registrar(el);
      }}
      data-pagina={numero}
      className="relative shrink-0 bg-white shadow-lg shadow-black/40"
      style={{ width: largura, height: altura }}
    >
      <canvas ref={canvas} className="block h-full w-full" aria-label={`Página ${numero}`} />
      {!desenhou && <div className="absolute inset-0 grid place-items-center text-xs text-neutral-400">{numero}</div>}
    </div>
  );
};
