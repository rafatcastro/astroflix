import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { autorizarNoGoogle } from '../api/driveAuth';

const MOTIVOS: Record<string, string> = {
  'sem-nuvem': 'O app não está ligado a uma conta nesta versão.',
  'sem-credenciais': 'O login com o Google não está configurado nesta versão.',
};

// Login obrigatório: sem conta, o app inteiro fica atrás desta tela. A trava de
// verdade é no servidor (401 em toda rota de dados); aqui é só a porta de entrada.
// Versão sem projeto de nuvem (fork, desenvolvimento) passa direto.
export default function PortaoConta({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: conta, isError, refetch } = useQuery({ queryKey: ['conta'], queryFn: api.conta, staleTime: 60_000 });
  const [fase, setFase] = useState<'parado' | 'navegador' | 'erro'>('parado');
  const [erro, setErro] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (isError) {
    return (
      <Tela>
        <p className="text-sm text-neutral-400">Não foi possível falar com o servidor do app.</p>
        <button type="button" onClick={() => void refetch()} className={BOTAO}>
          Tentar de novo
        </button>
      </Tela>
    );
  }
  if (!conta) return <div className="min-h-screen bg-studio-black" />;
  if (!conta.configurada || conta.entrou) return <>{children}</>;

  const entrar = async () => {
    setErro(null);
    let url: string;
    try {
      url = (await api.contaLogin()).url;
    } catch (e) {
      setFase('erro');
      setErro(MOTIVOS[e instanceof Error ? e.message : ''] ?? 'Não foi possível começar o login. Tente de novo.');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setFase('navegador');
    const ok = await autorizarNoGoogle(url, { signal: ctrl.signal, resultado: '/api/conta/login/resultado' });
    if (ctrl.signal.aborted) return;
    if (ok) {
      // A biblioteca desta conta chega na primeira sincronização: tudo é relido.
      await qc.invalidateQueries();
      setFase('parado');
    } else {
      setFase('erro');
      setErro('O login não foi concluído. Se você fechou a janela do Google, é só tentar de novo.');
    }
  };

  return (
    <Tela>
      <p className="max-w-xs text-balance text-neutral-400">Seus cursos e seu progresso em qualquer computador.</p>
      {fase === 'navegador' ? (
        <div className="flex flex-col items-center gap-3" role="status">
          <p className="text-sm text-neutral-300">Continue no navegador para entrar com o Google…</p>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setFase('parado');
            }}
            className="min-h-[44px] rounded-lg px-4 text-sm text-neutral-400 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => void entrar()} className={BOTAO}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
            </svg>
            Entrar com Google
          </button>
          {fase === 'erro' && erro && (
            <p role="alert" className="max-w-sm text-sm text-amber-200">
              {erro}
            </p>
          )}
        </>
      )}
    </Tela>
  );
}

const BOTAO =
  'inline-flex min-h-[44px] items-center gap-2.5 rounded-lg bg-neutral-100 px-5 text-sm font-medium text-neutral-900 transition-colors motion-reduce:transition-none hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-studio-black';

function Tela({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-studio-black px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-100">Learnflix</h1>
        {children}
      </div>
    </main>
  );
}
