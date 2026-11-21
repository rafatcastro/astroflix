import { useState } from 'react';
import type { LessonDTO } from '../api/client';

// O curso já foi organizado (MapearCurso) e o re-escaneio trouxe aulas que não
// estavam lá (o grupo do Telegram ganhou mensagens, a pasta ganhou vídeos): cada
// uma pergunta em que módulo entra, no fim dele. Até a pessoa escolher, elas ficam
// depois de todas, com o módulo que veio das pastas.
export default function AulasNovas({
  aulas,
  modulos,
  onColocar,
  onOrganizarTudo,
  onDepois,
}: {
  aulas: LessonDTO[];
  /** Os módulos do mapeamento, na ordem. */
  modulos: string[];
  onColocar: (escolhas: Array<{ id: string; modulo: string | null }>) => Promise<void>;
  onOrganizarTudo: () => void;
  onDepois: () => void;
}) {
  // A sugestão: o módulo com o mesmo nome da pasta (ou do tópico) da aula; senão, o último.
  const sugestao = (l: LessonDTO) => (l.module && modulos.includes(l.module) ? l.module : (modulos[modulos.length - 1] ?? ''));
  const [escolhas, setEscolhas] = useState<Record<string, string>>(() => Object.fromEntries(aulas.map((l) => [l.id, sugestao(l)])));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const todas = (valor: string) => setEscolhas(Object.fromEntries(aulas.map((l) => [l.id, valor])));
  const colocar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await onColocar(aulas.map((l) => ({ id: l.id, modulo: escolhas[l.id] || null })));
    } catch {
      setErro('Não foi possível salvar. Tente de novo.');
      setSalvando(false);
    }
  };
  const opcoes = (
    <>
      <option value="">Fora dos módulos</option>
      {modulos.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </>
  );
  const seletor =
    'h-8 max-w-[12rem] truncate rounded-md border border-neutral-700 bg-neutral-800 px-2 text-xs text-neutral-200 outline-none focus:ring-2 focus:ring-blue-600';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onDepois}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aulas-novas-titulo"
        className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-xl bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="aulas-novas-titulo" className="font-medium text-neutral-100">
          {aulas.length === 1 ? '1 aula nova' : `${aulas.length} aulas novas`}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">Escolha o módulo de cada uma. Ela entra no fim dele.</p>
        {aulas.length > 1 && (
          <label className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
            Todas para
            <select value="-" onChange={(e) => e.target.value !== '-' && todas(e.target.value)} className={seletor}>
              <option value="-">…</option>
              {opcoes}
            </select>
          </label>
        )}
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {aulas.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-lg bg-neutral-800/60 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm" title={l.relPath}>
                {l.title}
              </span>
              <select
                value={escolhas[l.id] ?? ''}
                onChange={(e) => setEscolhas((s) => ({ ...s, [l.id]: e.target.value }))}
                aria-label={`Módulo de "${l.title}"`}
                className={seletor}
              >
                {opcoes}
              </select>
            </li>
          ))}
        </ul>
        {erro && (
          <p role="alert" className="mt-2 text-sm text-amber-200">
            {erro}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onOrganizarTudo}
            className="mr-auto rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Organizar o curso todo…
          </button>
          <button
            type="button"
            onClick={onDepois}
            className="rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Depois
          </button>
          <button
            type="button"
            disabled={salvando}
            onClick={() => void colocar()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            {salvando ? 'Salvando…' : 'Colocar'}
          </button>
        </div>
      </div>
    </div>
  );
}
