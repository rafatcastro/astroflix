import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

export type Proposta = Array<{ nome: string | null; aulas: Array<{ id: string; titulo: string }> }>;

// "Organizar por texto…" (menu ⋯ do curso do Telegram): a pessoa escreve ou cola
// um texto e o Claude Code dela propõe os módulos. A proposta não é gravada aqui:
// abre na tela de mapeamento (MapearCurso), para conferir e salvar.

const ERROS: Record<string, string> = {
  'sem-claude': 'O Claude Code não está instalado nesta máquina. Instale em claude.com/claude-code e entre na sua conta pelo terminal (claude), depois tente de novo.',
  demorou: 'O Claude demorou demais para responder. Tente de novo, talvez com um texto mais curto.',
  'resposta-invalida': 'O Claude não conseguiu montar os módulos com esse texto. Tente explicar de outro jeito.',
  'texto-vazio': 'Escreva o texto primeiro.',
};

export default function ModelarPorTexto({
  courseId,
  onProposta,
  onFechar,
}: {
  courseId: string;
  onProposta: (p: Proposta) => void;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  // O pedido que terminar depois de a janela fechar não abre a tela de mapeamento.
  const vivo = useRef(true);
  useEffect(() => {
    campo.current?.focus();
    return () => {
      vivo.current = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onFechar();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onFechar]);

  const organizar = async () => {
    if (!texto.trim()) {
      setErro(ERROS['texto-vazio']);
      return campo.current?.focus();
    }
    setPensando(true);
    setErro(null);
    try {
      const r = await api.modelarPorTexto(courseId, texto);
      if (vivo.current) onProposta(r.modulos);
    } catch (e) {
      if (!vivo.current) return;
      const codigo = (e as Error).message;
      const mensagem = (e as { mensagem?: string }).mensagem;
      setErro(ERROS[codigo] ?? `O Claude não conseguiu organizar${mensagem ? `: ${mensagem}` : '.'}`);
    } finally {
      if (vivo.current) setPensando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modelar-titulo"
        className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modelar-titulo" className="font-medium text-neutral-100">
          Organizar por texto
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Cole o índice do curso ou diga como quer os módulos. O Claude monta uma proposta, e você confere antes de salvar.
        </p>
        <textarea
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void organizar();
          }}
          disabled={pensando}
          rows={10}
          placeholder={'Módulo 1 - Introdução: aulas 1 a 3\nMódulo 2 - Prática: o resto\n\nou cole o menu do canal'}
          aria-label="Texto para organizar o curso"
          className="mt-3 min-h-[10rem] w-full flex-1 resize-y rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
        />
        {pensando && (
          <p role="status" className="mt-2 text-sm text-neutral-400">
            O Claude está organizando… pode levar um minuto.
          </p>
        )}
        {erro && (
          <p role="alert" className="mt-2 text-sm text-amber-200">
            {erro}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={pensando}
            onClick={() => void organizar()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            {pensando ? 'Organizando…' : 'Organizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
