import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { materialUrl } from '../api/client';
import { cliqueFora } from '../lib/desktop';
import { abrirPdfDaUrl } from '../lib/pdf';

// Os arquivos do curso que não são vídeo abrem aqui, por cima da página, como
// abririam no visualizador do sistema: PDF pelo pdf.js (o mesmo do leitor de
// PDFs), texto e código como texto, Markdown e notebook do Jupyter formatados,
// Word pelo mammoth e planilhas pelo SheetJS. Os pacotes entram só quando um
// arquivo daquele tipo é aberto. O HTML que sai do Markdown, do notebook e do
// Word passa pelo DOMPurify: o arquivo vem de qualquer lugar e é mostrado na
// mesma origem da API.

export type TipoDeVisualizacao = 'pdf' | 'imagem' | 'texto' | 'markdown' | 'notebook' | 'word' | 'planilha';

const TEXTO = new Set([
  'txt', 'log', 'srt', 'vtt', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sql', 'sh', 'bash', 'zsh',
  'bat', 'ps1', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb',
  'php', 'swift', 'r', 'm', 'scala', 'lua', 'pl', 'css', 'scss', 'html', 'htm', 'vue', 'svelte', 'dockerfile', 'gradle', 'properties',
]);
const IMAGEM = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const PLANILHA = new Set(['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv']);

const extensao = (nome: string) => (nome.includes('.') ? nome.split('.').pop()!.toLowerCase() : nome.toLowerCase());

/** Como o arquivo abre no app, ou null quando só dá para baixar (zip, pptx, doc antigo…). */
export function tipoDeVisualizacao(nome: string): TipoDeVisualizacao | null {
  const ext = extensao(nome);
  if (ext === 'pdf') return 'pdf';
  if (IMAGEM.has(ext)) return 'imagem';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'ipynb') return 'notebook';
  if (ext === 'docx') return 'word';
  if (PLANILHA.has(ext)) return 'planilha';
  if (TEXTO.has(ext)) return 'texto';
  return null;
}

export type Visualizado = { id: string; name: string } | null;

// Texto maior que isso abre só o começo: um log de 200 MB travaria a janela.
const TEXTO_NO_MAXIMO = 5 * 1024 * 1024;

async function baixar(id: string): Promise<ArrayBuffer> {
  const r = await fetch(materialUrl(id));
  if (!r.ok) throw new Error(String(r.status));
  return r.arrayBuffer();
}

// UTF-8 primeiro; se vier com caractere inválido, é o Latin-1 do Windows (comum em .txt de curso).
function decodificar(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

async function limpar(html: string): Promise<string> {
  const { default: DOMPurify } = await import('dompurify');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

async function markdown(texto: string): Promise<string> {
  const { marked } = await import('marked');
  return limpar(await marked.parse(texto, { gfm: true }));
}

interface Celula {
  cell_type: 'markdown' | 'code' | 'raw';
  source: string | string[];
  outputs?: Array<{
    output_type: string;
    text?: string | string[];
    data?: Record<string, string | string[]>;
    ename?: string;
    evalue?: string;
  }>;
}
const juntar = (t: string | string[] | undefined) => (Array.isArray(t) ? t.join('') : (t ?? ''));

async function notebook(buf: ArrayBuffer): Promise<ReactNode> {
  const nb = JSON.parse(decodificar(buf)) as { cells?: Celula[] };
  const celulas = await Promise.all(
    (nb.cells ?? []).map(async (c, i) => {
      if (c.cell_type === 'markdown') {
        return <div key={i} className="documento" dangerouslySetInnerHTML={{ __html: await markdown(juntar(c.source)) }} />;
      }
      const saidas = (c.outputs ?? []).map((o, j) => {
        const png = o.data?.['image/png'];
        if (png) return <img key={j} alt="" src={`data:image/png;base64,${juntar(png).replace(/\s/g, '')}`} className="max-w-full rounded bg-white" />;
        const texto = o.output_type === 'error' ? `${o.ename}: ${o.evalue}` : juntar(o.text ?? o.data?.['text/plain']);
        return texto ? (
          <pre key={j} className={`whitespace-pre-wrap break-words text-xs ${o.output_type === 'error' ? 'text-red-300' : 'text-neutral-300'}`}>
            {texto}
          </pre>
        ) : null;
      });
      return (
        <div key={i} className="space-y-2">
          <pre className="overflow-x-auto rounded-lg bg-neutral-900 p-3 text-sm text-neutral-100">{juntar(c.source)}</pre>
          {saidas.some(Boolean) && <div className="space-y-2 border-l-2 border-neutral-800 pl-3">{saidas}</div>}
        </div>
      );
    }),
  );
  return <div className="mx-auto max-w-4xl space-y-4">{celulas}</div>;
}

async function word(buf: ArrayBuffer): Promise<ReactNode> {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const r = await mammoth.convertToHtml({ arrayBuffer: buf });
  return (
    <div className="mx-auto max-w-3xl rounded-lg bg-white px-6 py-8 text-neutral-900 sm:px-12">
      <div className="documento documento-claro" dangerouslySetInnerHTML={{ __html: await limpar(r.value) }} />
    </div>
  );
}

function Planilha({ buf }: { buf: ArrayBuffer }) {
  const [abas, setAbas] = useState<Array<{ nome: string; html: string }> | null>(null);
  const [aba, setAba] = useState(0);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const XLSX = await import('xlsx');
      const livro = XLSX.read(buf, { type: 'array', dense: true });
      const lista = await Promise.all(
        livro.SheetNames.map(async (nome) => ({ nome, html: await limpar(XLSX.utils.sheet_to_html(livro.Sheets[nome], { header: '', footer: '' })) })),
      );
      if (vivo) setAbas(lista);
    })();
    return () => {
      vivo = false;
    };
  }, [buf]);
  if (!abas) return <p className="text-sm text-neutral-400">Abrindo a planilha…</p>;
  return (
    <div>
      {abas.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1" role="tablist">
          {abas.map((a, i) => (
            <button
              key={a.nome}
              type="button"
              role="tab"
              aria-selected={i === aba}
              onClick={() => setAba(i)}
              className={`min-h-[36px] rounded-md px-3 text-sm ${i === aba ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800'}`}
            >
              {a.nome}
            </button>
          ))}
        </div>
      )}
      <div className="planilha overflow-auto rounded-lg bg-white text-neutral-900" dangerouslySetInnerHTML={{ __html: abas[aba]?.html ?? '' }} />
    </div>
  );
}

// Cada página é desenhada só quando chega perto da tela, na largura disponível.
function PaginaPdf({ doc, numero }: { doc: PDFDocumentProxy; numero: number }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [proporcao, setProporcao] = useState(1.414);
  const [desenhada, setDesenhada] = useState(false);
  useEffect(() => {
    const el = caixa.current;
    if (!el || desenhada) return;
    const obs = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        obs.disconnect();
        void (async () => {
          const pagina = await doc.getPage(numero);
          const base = pagina.getViewport({ scale: 1 });
          setProporcao(base.height / base.width);
          const escala = (el.clientWidth * (window.devicePixelRatio || 1)) / base.width;
          const vp = pagina.getViewport({ scale: escala });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width);
          canvas.height = Math.round(vp.height);
          canvas.className = 'block h-auto w-full';
          await pagina.render({ canvas, viewport: vp }).promise;
          el.replaceChildren(canvas);
          setDesenhada(true);
        })().catch(() => undefined);
      },
      { rootMargin: '600px 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [doc, numero, desenhada]);
  return (
    <div
      ref={caixa}
      aria-label={`Página ${numero}`}
      className="w-full overflow-hidden rounded bg-white shadow"
      style={desenhada ? undefined : { aspectRatio: `1 / ${proporcao}` }}
    />
  );
}

function Pdf({ id }: { id: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    let aberto: PDFDocumentProxy | null = null;
    abrirPdfDaUrl(materialUrl(id)).then(
      (d) => {
        if (!vivo) return void d.destroy();
        aberto = d;
        setDoc(d);
      },
      () => vivo && setErro(true),
    );
    return () => {
      vivo = false;
      void aberto?.destroy();
    };
  }, [id]);
  if (erro) return <p className="text-sm text-amber-200">Não deu para abrir este PDF. Tente baixar.</p>;
  if (!doc) return <p className="text-sm text-neutral-400">Abrindo o PDF…</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PaginaPdf key={i} doc={doc} numero={i + 1} />
      ))}
    </div>
  );
}

function Conteudo({ viewer, tipo, descricao }: { viewer: NonNullable<Visualizado>; tipo: TipoDeVisualizacao; descricao?: boolean }) {
  const [pronto, setPronto] = useState<ReactNode>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (tipo === 'pdf' || tipo === 'imagem') return;
    let vivo = true;
    setPronto(null);
    setErro(false);
    void (async () => {
      const buf = await baixar(viewer.id);
      if (tipo === 'planilha') return <Planilha buf={buf} />;
      if (tipo === 'word') return word(buf);
      if (tipo === 'notebook') return notebook(buf);
      const cortado = buf.byteLength > TEXTO_NO_MAXIMO;
      const texto = decodificar(cortado ? buf.slice(0, TEXTO_NO_MAXIMO) : buf);
      const aviso = cortado && <p className="mb-3 text-sm text-amber-200">Arquivo grande: mostrando só o começo. Baixe para ver inteiro.</p>;
      if (tipo === 'markdown') {
        return (
          <div className="mx-auto max-w-3xl">
            {aviso}
            <div className="documento" dangerouslySetInnerHTML={{ __html: await markdown(texto) }} />
          </div>
        );
      }
      // Como descrição da aula, o texto corre como o de uma página, sem cara de código.
      if (descricao) {
        return (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">
            {aviso}
            {texto.trim()}
          </div>
        );
      }
      return (
        <div className="mx-auto max-w-5xl">
          {aviso}
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-neutral-900 p-4 font-mono text-sm leading-relaxed text-neutral-100">{texto}</pre>
        </div>
      );
    })().then(
      (no) => vivo && setPronto(no),
      () => vivo && setErro(true),
    );
    return () => {
      vivo = false;
    };
  }, [viewer.id, tipo, descricao]);

  if (tipo === 'pdf') return <Pdf id={viewer.id} />;
  if (tipo === 'imagem') {
    return (
      <div className="grid h-full place-items-center">
        <img src={materialUrl(viewer.id)} alt={viewer.name} className="max-h-full max-w-full rounded-lg object-contain" />
      </div>
    );
  }
  if (erro) return <p className="text-sm text-amber-200">Não deu para abrir este arquivo. Tente baixar.</p>;
  return pronto ?? <p className="text-sm text-neutral-400">Abrindo…</p>;
}

/** O conteúdo do arquivo direto na página, sem a janela por cima (a descrição embaixo do vídeo). */
export function ConteudoArquivo({ id, nome }: { id: string; nome: string }) {
  const tipo = tipoDeVisualizacao(nome);
  return tipo ? <Conteudo viewer={{ id, name: nome }} tipo={tipo} descricao /> : null;
}

export function VisualizadorArquivo({ viewer, onFechar }: { viewer: NonNullable<Visualizado>; onFechar: () => void }) {
  const tipo = tipoDeVisualizacao(viewer.name);
  // Esc fecha, como no resto do app; o vídeo por baixo não recebe a tecla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onFechar();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onFechar]);

  return (
    <div role="dialog" aria-modal="true" aria-label={viewer.name} className="fixed inset-0 z-40 flex flex-col bg-black/90 p-3 sm:p-6" onClick={onFechar}>
      <div className="mb-2 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm text-neutral-200">{viewer.name}</span>
        <div className="flex shrink-0 gap-2">
          <a
            href={materialUrl(viewer.id, true)}
            download={viewer.name}
            onClick={(e) => cliqueFora(e, materialUrl(viewer.id, true))}
            className="min-h-[44px] rounded-lg bg-neutral-800 px-3 text-sm leading-[44px] text-neutral-200 hover:bg-neutral-700"
          >
            Baixar
          </a>
          <button
            type="button"
            autoFocus
            onClick={onFechar}
            className="min-h-[44px] rounded-lg bg-neutral-800 px-3 text-sm text-neutral-200 hover:bg-neutral-700"
          >
            Fechar
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {tipo ? (
          <Conteudo viewer={viewer} tipo={tipo} />
        ) : (
          <p className="text-sm text-neutral-400">Este tipo de arquivo não abre no app. Use Baixar.</p>
        )}
      </div>
    </div>
  );
}
