import { Link, useSearchParams } from 'react-router-dom';
import { useCourses, useFlashcards, useMudarFlashcards } from '../api/hooks';
import { AvisoAnki, CartaoFlashcard, FormFlashcard } from '../components/Flashcards';
import { ArrowLeft } from '../components/icons';

// Todos os flashcards: os gerais e os de cada curso. Aqui se cria card que não é
// de uma aula (geral, ou do curso todo); os de aula nascem no painel do player.
// Os nomes dos baralhos aparecem por extenso porque é por eles que a pessoa vai
// procurar os cards no Anki.
const BARALHO_RAIZ = 'Learnflix::Cursos';
const baralhoDoCurso = (titulo: string) => `${BARALHO_RAIZ}::${titulo.replace(/::/g, ':').replace(/\s+/g, ' ').trim()}`;

export default function Flashcards() {
  const [params, setParams] = useSearchParams();
  const cursoId = params.get('curso');
  const { data: cursos } = useCourses();
  const curso = cursos?.find((c) => c.id === cursoId) ?? null;
  const { data, isLoading } = useFlashcards(cursoId ? { courseId: cursoId } : { geral: true });
  const { criar } = useMudarFlashcards();

  const deCurso = data?.cards.filter((c) => c.lessonId == null) ?? [];
  const deAulas = data?.cards.filter((c) => c.lessonId != null) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        to={cursoId ? `/course/${cursoId}` : '/'}
        className="inline-flex items-center gap-1.5 rounded text-sm text-neutral-400 transition-colors hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <ArrowLeft size={16} /> {cursoId ? 'Curso' : 'Biblioteca'}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Flashcards</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Os cards vão para o Anki, onde você revisa. Revisar o baralho <code className="text-neutral-300">{BARALHO_RAIZ}</code> pega
        todos.
      </p>

      <label className="mt-6 block max-w-md">
        <span className="mb-1 block text-xs text-neutral-400">Mostrar</span>
        <select
          value={cursoId ?? ''}
          onChange={(e) => setParams(e.target.value ? { curso: e.target.value } : {}, { replace: true })}
          className="min-h-[44px] w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">Gerais</option>
          {cursos?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      <section className="mt-6 rounded-xl bg-neutral-900/60 p-4">
        <h2 className="text-sm font-semibold text-neutral-300">{curso ? 'Novo card do curso' : 'Novo card geral'}</h2>
        <p className="mb-3 mt-0.5 text-xs text-neutral-500">
          Vai para <code>{curso ? baralhoDoCurso(curso.title) : BARALHO_RAIZ}</code>.
          {curso ? ' Para prender o card a um momento do vídeo, crie pelo painel da aula (tecla C).' : ''}
        </p>
        <FormFlashcard
          key={cursoId ?? 'geral'}
          rotulo="Adicionar card"
          ocupado={criar.isPending}
          onSalvar={(c) => criar.mutateAsync(cursoId ? { ...c, courseId: cursoId } : c)}
        />
      </section>

      <div className="mt-6 space-y-6">
        <AvisoAnki anki={data?.anki} pendentes={data?.pendentes ?? 0} />
        {isLoading ? (
          <p className="text-sm text-neutral-500">Carregando…</p>
        ) : !data?.cards.length ? (
          <p className="text-sm text-neutral-500">
            {cursoId ? 'Nenhum card deste curso ainda.' : 'Nenhum card geral ainda.'}
          </p>
        ) : (
          <>
            {deCurso.length > 0 && (
              <section>
                {deAulas.length > 0 && <h2 className="mb-2 text-sm font-semibold text-neutral-300">Do curso</h2>}
                <ul className="space-y-2">
                  {deCurso.map((c) => (
                    <CartaoFlashcard key={c.id} card={c} />
                  ))}
                </ul>
              </section>
            )}
            {deAulas.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-neutral-300">Das aulas</h2>
                <ul className="space-y-2">
                  {deAulas.map((c) => (
                    <CartaoFlashcard key={c.id} card={c} mostrarOrigem />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
