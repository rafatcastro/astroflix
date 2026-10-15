import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Flashcard } from '../api/client';
import { useFlashcards, useMudarFlashcards } from '../api/hooks';
import { AvisoAnki, CartaoFlashcard, FormFlashcard } from '../components/Flashcards';
import CabecalhoCategoria, { SEM } from '../components/CabecalhoCategoria';

// A aba Questões de uma categoria: os flashcards dela, como estão no Anki. As
// gerais ficam em Learnflix::<categoria>; as de cada curso e PDF, embaixo
// (::Cursos::<título>, ::PDFs::<título>). Revisar a categoria no Anki pega tudo.

interface Grupo {
  chave: string;
  titulo: string;
  link: string | null;
  baralho: string;
  cards: Flashcard[];
}

function agrupar(cards: Flashcard[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const c of cards) {
    const [chave, titulo, link] = c.courseId
      ? [`c:${c.courseId}`, c.courseTitle ?? 'Curso', `/course/${c.courseId}`]
      : c.documentoId
        ? [`d:${c.documentoId}`, c.documentoTitulo ?? 'PDF', `/pdf/${c.documentoId}`]
        : ['geral', '', null];
    const g = grupos.get(chave) ?? { chave, titulo, link, baralho: c.baralho, cards: [] };
    g.cards.push(c);
    grupos.set(chave, g);
  }
  return [...grupos.values()].filter((g) => g.chave !== 'geral');
}

export default function Questoes({ categoria }: { categoria: string }) {
  const { data, isLoading } = useFlashcards({ categoria });
  const { criar } = useMudarFlashcards();
  const { data: baralho } = useQuery({
    queryKey: ['baralho', categoria],
    queryFn: () => api.baralho(categoria === SEM ? {} : { categoria }),
  });

  const gerais = data?.cards.filter((c) => !c.courseId && !c.documentoId) ?? [];
  const grupos = agrupar(data?.cards ?? []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <CabecalhoCategoria
        cat={categoria}
        info={data && data.cards.length > 0 ? `${data.cards.length} card${data.cards.length === 1 ? '' : 's'}` : undefined}
      />

      <div className="max-w-3xl space-y-8">
        <section className="rounded-xl bg-neutral-900/60 p-4">
          <h2 className="text-sm font-semibold text-neutral-300">Nova questão geral</h2>
          <p className="mb-3 mt-0.5 text-xs text-neutral-500">
            Vai para <code className="text-neutral-300">{baralho?.baralho ?? '…'}</code>. As de um curso nascem no painel da aula (tecla
            C); as de um PDF, no leitor.
          </p>
          <FormFlashcard
            key={categoria}
            rotulo="Adicionar card"
            ocupado={criar.isPending}
            onSalvar={(c) => criar.mutateAsync(categoria === SEM ? c : { ...c, categoriaId: categoria })}
          />
        </section>

        <AvisoAnki anki={data?.anki} pendentes={data?.pendentes ?? 0} />

        {isLoading ? (
          <p className="text-sm text-neutral-500">Carregando…</p>
        ) : !data?.cards.length ? (
          <p className="text-sm text-neutral-500">Nenhuma questão nesta categoria ainda.</p>
        ) : (
          <>
            {gerais.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-neutral-300">Gerais</h2>
                <p className="mb-2 text-xs text-neutral-500">
                  <code>{gerais[0].baralho}</code>
                </p>
                <ul className="space-y-2">
                  {gerais.map((c) => (
                    <CartaoFlashcard key={c.id} card={c} />
                  ))}
                </ul>
              </section>
            )}
            {grupos.map((g) => (
              <section key={g.chave}>
                <h2 className="text-sm font-semibold text-neutral-300">
                  {g.link ? (
                    <Link to={g.link} className="hover:text-white hover:underline">
                      {g.titulo}
                    </Link>
                  ) : (
                    g.titulo
                  )}
                </h2>
                <p className="mb-2 text-xs text-neutral-500">
                  <code>{g.baralho}</code>
                </p>
                <ul className="space-y-2">
                  {g.cards.map((c) => (
                    <CartaoFlashcard key={c.id} card={c} mostrarOrigem />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
