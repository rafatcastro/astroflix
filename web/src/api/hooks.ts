import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export const useCourses = (archived?: boolean) => useQuery({ queryKey: ['courses', { archived: !!archived }], queryFn: () => api.listCourses(archived) });
// Enquanto a pasta do Drive é lida em segundo plano, pergunta de novo a cada
// pouco: é assim que as aulas aparecem na tela conforme vão sendo encontradas.
export const useCourse = (id: string) =>
  useQuery({
    queryKey: ['course', id],
    queryFn: () => api.getCourse(id),
    refetchInterval: (q) => (q.state.data?.importacao?.carregando ? 1500 : false),
  });
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
