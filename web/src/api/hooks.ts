import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type FiltroFlashcards } from './client';
import { autorizarNoGoogle } from './driveAuth';

export const useCourses = (archived?: boolean) => useQuery({ queryKey: ['courses', { archived: !!archived }], queryFn: () => api.listCourses(archived) });
// Enquanto a pasta do Drive é lida em segundo plano, pergunta de novo a cada
// pouco: é assim que as aulas aparecem na tela conforme vão sendo encontradas.
export const useCourse = (id: string) =>
  useQuery({
    queryKey: ['course', id],
    queryFn: () => api.getCourse(id),
    refetchInterval: (q) =>
      q.state.data?.importacao?.carregando || q.state.data?.download?.ativo ? 1500 : false,
  });
// Os "Baixar curso inteiro" (painel global, botões do curso e da categoria).
// Pergunta a cada segundo só enquanto algum está andando (ou vai tentar de novo); quem começa um
// download invalida ['downloads'] para o painel aparecer na hora.
export const useDownloads = () =>
  useQuery({
    queryKey: ['downloads'],
    queryFn: api.listarDownloads,
    refetchInterval: (q) => (q.state.data?.itens.some((e) => e.ativo || e.tentarEm) ? 1000 : false),
  });
// Flashcards: cada lista pergunta ao Anki (o servidor envia os pendentes e relê
// as notas), então não precisa refazer a cada foco de janela.
export const useFlashcards = (filtro: FiltroFlashcards, enabled = true) =>
  useQuery({ queryKey: ['flashcards', filtro], queryFn: () => api.listarFlashcards(filtro), enabled, refetchOnWindowFocus: false });

export function useMudarFlashcards() {
  const qc = useQueryClient();
  const depois = () => {
    qc.invalidateQueries({ queryKey: ['flashcards'] });
    qc.invalidateQueries({ queryKey: ['ankiStatus'] });
  };
  return {
    criar: useMutation({ mutationFn: api.criarFlashcard, onSuccess: depois }),
    editar: useMutation({
      mutationFn: ({ id, ...c }: { id: string; frente: string; verso: string }) => api.editarFlashcard(id, c),
      onSuccess: depois,
    }),
    apagar: useMutation({ mutationFn: api.apagarFlashcard, onSuccess: depois }),
  };
}

export const useCollections = () => useQuery({ queryKey: ['collections'], queryFn: api.listCollections });
export const useCourseRoots = () => useQuery({ queryKey: ['courseRoots'], queryFn: api.listCourseRoots });

export function useCreateCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.createCourse(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
  });
}

export function useSetComplete(courseId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => api.setComplete(id, completed),
    onSuccess: () => {
      if (courseId) qc.invalidateQueries({ queryKey: ['course', courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
    },
  });
}

// O acesso ao Drive é pedido junto com o login da conta; quem desmarcou lá não vê
// "Do Google Drive" nos menus, e sim "Conectar o Google Drive", que pede só ele.
export function useConexaoDrive() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['driveStatus'], queryFn: api.driveStatus });
  const [conectando, setConectando] = useState(false);
  async function conectar(): Promise<boolean> {
    setConectando(true);
    try {
      const { url } = await api.driveIniciarAuth();
      const ok = await autorizarNoGoogle(url);
      await qc.invalidateQueries({ queryKey: ['driveStatus'] });
      return ok;
    } catch {
      return false;
    } finally {
      setConectando(false);
    }
  }
  // null enquanto não se sabe: os menus mantêm a opção de importar.
  return { conectado: data ? data.conectado : null, email: data?.email ?? null, conectando, conectar };
}
