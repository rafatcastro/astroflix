import { FalhaNuvem, type ClienteSupabase, type SessaoSupabase } from './cliente';

// Supabase de mentira para os testes, com as mesmas regras de supabase/schema.sql:
// cada linha tem dono (o token diz quem é), o banco carimba atualizado_em em toda
// escrita, e o progresso nunca anda para trás.
const CHAVES: Record<string, string[]> = {
  colecoes: ['id'],
  cursos: ['id'],
  aulas: ['curso_id', 'rel_path'],
  progresso: ['curso_id', 'rel_path'],
  flashcards: ['id'],
  pastas_por_maquina: ['curso_id', 'maquina_id'],
};

export function supabaseFalso() {
  const tabelas = new Map<string, Map<string, Record<string, any>>>(Object.keys(CHAVES).map((t) => [t, new Map()]));
  let relogio = 0;
  const estado = { fora: false, chamadas: 0 };
  const carimbo = () => new Date(Date.UTC(2030, 0, 1) + ++relogio).toISOString();
  const dono = (token: string) => {
    if (estado.fora) throw new FalhaNuvem('sem-conexao');
    if (!token.startsWith('tok-')) throw new FalhaNuvem('sessao-expirada', 401);
    return token.slice(4);
  };
  const sessao = (user: string): SessaoSupabase => ({
    accessToken: `tok-${user}`,
    refreshToken: `ref-${user}`,
    expiraEm: Date.now() + 3600_000,
    userId: user,
    email: `${user}@exemplo.com`,
  });

  const cliente: ClienteSupabase = {
    async entrarComIdToken(idToken) {
      if (estado.fora) throw new FalhaNuvem('sem-conexao');
      return sessao(idToken.replace(/^id-/, ''));
    },
    async renovar(refresh) {
      return sessao(refresh.replace(/^ref-/, ''));
    },
    async sair() {},
    async upsert(token, tabela, linhas) {
      const user = dono(token);
      estado.chamadas++;
      const t = tabelas.get(tabela)!;
      for (const l of linhas as Record<string, any>[]) {
        const k = CHAVES[tabela].map((c) => l[c]).join('|');
        const velha = t.get(k);
        if (velha && velha.user_id !== user) throw new FalhaNuvem('recusado', 403);
        const nova: Record<string, any> = { ...velha, ...l, user_id: user, atualizado_em: carimbo() };
        if (tabela === 'progresso' && velha) {
          if (nova.mais_longe_sec < velha.mais_longe_sec) {
            nova.mais_longe_sec = velha.mais_longe_sec;
            nova.posicao_sec = velha.posicao_sec;
          }
          if (nova.alterado_em < velha.alterado_em) {
            nova.concluida = velha.concluida;
            nova.concluida_em = velha.concluida_em;
            nova.auto_concluida = velha.auto_concluida;
            nova.alterado_em = velha.alterado_em;
          }
        }
        t.set(k, nova);
      }
    },
    async mudancas(token, tabela, desde, limite) {
      const user = dono(token);
      return [...tabelas.get(tabela)!.values()]
        .filter((l) => l.user_id === user && (!desde || l.atualizado_em > desde))
        .sort((a, b) => (a.atualizado_em < b.atualizado_em ? -1 : 1))
        .slice(0, limite)
        .map((l) => ({ ...l }));
    },
  };
  return { cliente, tabelas, estado, linhas: (t: string) => [...tabelas.get(t)!.values()] };
}
