import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useCourse } from '../api/hooks';
import { api, materialUrl, type MaterialDTO } from '../api/client';
import { cliqueFora } from '../lib/desktop';
import { KIND_LABEL } from './MaterialsSection';
import { VisualizadorArquivo, tipoDeVisualizacao, type Visualizado } from './VisualizadorArquivo';
import { formatDuration } from '../lib/format';
import { caminhoDaAula, filtrarArvore, montarArvore, type No } from '../lib/arvore';
import { CampoBusca } from './CampoBusca';
import { ChevronRight } from './icons';
import { CapaAula } from './CapaAula';
import { CaixaConcluida, moduloConcluido } from './CaixaConcluida';

// Lista de aulas ao lado do vídeo (estilo YouTube): fica sempre à vista, então
// trocar de aula não pede abrir painel nem sair da tela cheia. A aula atual vem
// destacada e a lista rola até ela, inclusive ao avançar sozinha para a próxima.
// As pastas começam recolhidas, menos o caminho da aula atual; ao passar para uma
// aula de outra pasta, só o caminho dela fica aberto.
export default function PlaylistSidebar({
  courseId,
  currentLessonId,
  onJump,
}: {
  courseId: string;
  currentLessonId: string;
  onJump: (lessonId: string) => void;
}) {
  const { data } = useCourse(courseId);
  const atualRef = useRef<HTMLButtonElement>(null);
  const todas = data ? data.modules.flatMap((m) => m.lessons) : [];
  const arvore = montarArvore(todas, data?.materials ?? [], data?.source);
  const [visualizado, setVisualizado] = useState<Visualizado>(null);
  const fecharVisualizador = useCallback(() => setVisualizado(null), []);
  const caminhoAtual = caminhoDaAula(arvore, currentLessonId).join('\n');
  const [abertos, setAbertos] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const buscando = busca.trim() !== '';

  useEffect(() => {
    setAbertos(caminhoAtual ? caminhoAtual.split('\n') : []);
  }, [caminhoAtual]);

  // Rola até a aula atual quando ela muda (ou o curso carrega) — inclusive se a
  // pasta dela só abriu no render seguinte —, mas não quando a pessoa abre outra pasta.
  const rolarRef = useRef(true);
  useEffect(() => {
    rolarRef.current = true;
  }, [currentLessonId, data]);
  useEffect(() => {
    if (!rolarRef.current || !atualRef.current) return;
    atualRef.current.scrollIntoView({ block: 'nearest' });
    rolarRef.current = false;
  });

  if (!data) return <p className="p-3 text-sm text-neutral-500">Carregando…</p>;
  const posicao = new Map(todas.map((l, i) => [l.id, i + 1]));
  // A coluna da esquerda cabe o maior número do curso: com milhares de aulas (Telegram),
  // "3984" numa coluna de 20 px invadia a capa.
  const larguraDoNumero = `${String(todas.length).length + 0.5}ch`;
  const visiveis = filtrarArvore(arvore, busca);
  const alternar = (chave: string) =>
    setAbertos((a) => (a.includes(chave) ? a.filter((c) => c !== chave) : [...a, chave]));

  // O arquivo fica na pasta dele, como na página do curso: o que o app sabe
  // mostrar abre por cima do vídeo; o resto é baixado.
  const linhaDoMaterial = (m: MaterialDTO, profundidade: number) => {
    const abre = !!tipoDeVisualizacao(m.name);
    const recuo = { paddingLeft: `${0.75 + profundidade * 0.75}rem` };
    return (
      <a
        key={m.id}
        href={materialUrl(m.id, true)}
        download={m.name}
        onClick={(e) => {
          if (abre) {
            e.preventDefault();
            setVisualizado({ id: m.id, name: m.name });
          } else cliqueFora(e, materialUrl(m.id, true));
        }}
        style={recuo}
        className="flex w-full items-center gap-2 py-2 pr-3 text-left text-sm hover:bg-neutral-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
      >
        <span className="w-5 shrink-0" />
        <span className="grid aspect-video w-24 shrink-0 place-items-center rounded bg-neutral-800 text-[10px] font-semibold tracking-wide text-neutral-400">
          {KIND_LABEL[m.kind]}
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 text-neutral-200">{m.name}</span>
      </a>
    );
  };

  const nivel = (nos: No[], profundidade: number) =>
    nos.map((no) => {
      // Cada nível recua um pouco: com a árvore toda aberta, dá para ver de que pasta é cada aula.
      const recuo = { paddingLeft: `${0.75 + profundidade * 0.75}rem` };
      if (no.tipo === 'material') return linhaDoMaterial(no.material, profundidade);
      if (no.tipo === 'pasta') {
        // Buscando, tudo o que sobrou fica aberto: a aula achada não pode ficar escondida numa pasta fechada.
        const aberto = buscando || abertos.includes(no.chave);
        const feitas = no.aulas.filter((l) => l.completed).length;
        const moduloFeito = moduloConcluido(no.aulas);
        const id = `pasta-${no.chave}`;
        return (
          <section key={no.chave}>
            <button
              type="button"
              onClick={() => alternar(no.chave)}
              aria-expanded={aberto}
              aria-controls={id}
              style={recuo}
              className={`flex w-full items-center gap-1.5 bg-neutral-950 pb-1 pr-3 pt-3 text-left text-xs hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                profundidade === 0 ? 'sticky top-0 z-10' : ''
              }`}
            >
              <ChevronRight
                size={14}
                className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`}
              />
              {no.aulas.length > 0 && <CaixaConcluida feito={moduloFeito} size={13} />}
              <span className="min-w-0 flex-1 truncate font-medium text-neutral-300">{no.nome}</span>
              <span className={`shrink-0 ${moduloFeito ? 'text-green-400' : 'text-neutral-500'}`}>
                {no.aulas.length ? `${feitas}/${no.aulas.length}` : `${no.materiais} arquivo${no.materiais === 1 ? '' : 's'}`}
              </span>
            </button>
            {aberto && <div id={id}>{nivel(no.filhos, profundidade + 1)}</div>}
          </section>
        );
      }
      const l = no.aula;
      const atual = l.id === currentLessonId;
      const estado = atual ? '▶' : l.completed ? <CaixaConcluida feito /> : l.position > 0 ? '◐' : '';
      return (
        <Fragment key={l.id}>
          <button
            ref={atual ? atualRef : undefined}
            type="button"
            onClick={() => onJump(l.id)}
            aria-current={atual ? 'true' : undefined}
            style={recuo}
            className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
              atual ? 'bg-blue-600/25' : 'hover:bg-neutral-800/70'
            }`}
          >
            <span style={{ minWidth: larguraDoNumero }} className={`grid w-5 shrink-0 place-items-center text-center text-xs tabular-nums ${l.completed && !atual ? 'text-green-400' : 'text-neutral-500'}`}>
              {estado || posicao.get(l.id)}
            </span>
            <span className="relative shrink-0">
              <CapaAula src={api.lessonThumbUrl(l.id)} className="aspect-video w-24 rounded" loading="lazy" />
              {l.durationSec != null && (
                <span className="escuro absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[10px] text-neutral-200">
                  {formatDuration(l.durationSec)}
                </span>
              )}
            </span>
            <span className={`line-clamp-2 min-w-0 flex-1 ${l.completed && !atual ? 'text-neutral-400' : 'text-neutral-100'}`}>
              {no.titulo}
            </span>
          </button>
          {/* Os anexos da aula, logo abaixo dela, um nível para dentro. */}
          {no.anexos.map((m) => linhaDoMaterial(m, profundidade + 1))}
        </Fragment>
      );
    });

  return (
    <div>
      <div className="p-3 pb-1">
        <CampoBusca valor={busca} onMudar={setBusca} />
      </div>
      {buscando && !visiveis.length ? (
        <p className="p-3 text-sm text-neutral-500">Nenhuma aula com “{busca.trim()}” neste curso.</p>
      ) : (
        nivel(visiveis, 0)
      )}
      {visualizado && <VisualizadorArquivo viewer={visualizado} onFechar={fecharVisualizador} />}
    </div>
  );
}
