import { useCourse } from '../api/hooks';
import { descricoesDasAulas } from '../lib/arvore';
import { ConteudoArquivo } from './VisualizadorArquivo';

// O texto que veio junto do vídeo com o mesmo nome ("Aula 3.mp4" e "Aula 3.txt"),
// embaixo dos botões do player, como a descrição de um vídeo. Ele sai da lista de
// arquivos do curso (ver descricoesDasAulas).
export default function DescricaoDaAula({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { data } = useCourse(courseId);
  if (!data) return null;
  const m = descricoesDasAulas(
    data.modules.flatMap((mod) => mod.lessons),
    data.materials,
  ).get(lessonId);
  if (!m) return null;
  return (
    <section aria-label="Descrição da aula" className="mt-4 rounded-lg bg-neutral-900/60 p-4">
      <ConteudoArquivo key={m.id} id={m.id} nome={m.name} />
    </section>
  );
}
