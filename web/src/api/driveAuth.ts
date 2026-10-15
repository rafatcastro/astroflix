import { abrirFora } from '../lib/desktop';

// Autorização do Google: um único lugar para o modal de link e para o player, que precisam do
// mesmo fluxo (abrir o login fora do app e esperar o resultado).

export const TEXTOS_ERRO_DRIVE: Record<string, string> = {
  'sem-acesso': 'Sua conta Google não tem acesso a esta pasta. Peça acesso ao dono do link.',
  'link-invalido': 'Cole o link de uma pasta do Google Drive.',
  'nao-e-pasta': 'Cole o link de uma pasta do Google Drive.',
  'cota-esgotada': 'O Google bloqueou downloads desta pasta por excesso de acessos. Tente de novo em algumas horas.',
  'sem-conexao': 'Sem conexão com o Google Drive.',
  'nao-autorizado': 'A autorização do Google expirou.',
  'sem-espaco': 'O disco está cheio. Libere espaço para o download continuar.',
  'nao-e-pdf': 'Esse link não é de um PDF nem de uma pasta. Cole o link de um PDF ou de uma pasta do Google Drive.',
  carregando: 'A pasta ainda está sendo lida. Espere terminar e tente de novo.',
  'sem-credenciais': 'O app do Google não está configurado. Configure um app próprio em Configurações → Google Drive.',
};

export const mensagemErroDrive = (erro: string): string =>
  TEXTOS_ERRO_DRIVE[erro] ?? 'Não foi possível falar com o Google Drive. Tente novamente.';

// O Google recusa login dentro de webview embutida (`disallowed_useragent`), então a
// autorização abre no navegador do sistema — e a página de callback, lá fora, não tem como
// avisar esta janela. A volta é perguntando ao servidor pelo state deste login (o servidor só
// guarda resultado de state que ele mesmo emitiu). Resolve true se conectou; false se o Google
// recusou, o prazo acabou ou quem chamou abortou (fechou o modal, saiu da aula).
const INTERVALO_MS = 1500;
const PRAZO_MS = 10 * 60_000; // o mesmo prazo do state no servidor

export function autorizarNoGoogle(
  url: string,
  // O login da conta usa o mesmo fluxo, com o resultado perguntado na rota dela.
  opts: { signal?: AbortSignal; resultado?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const state = new URL(url).searchParams.get('state');
    if (!state || opts.signal?.aborted) return resolve(false);
    void abrirFora(url);
    const inicio = Date.now();
    const fim = (ok: boolean) => {
      window.clearInterval(sondagem);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = () => fim(false);
    opts.signal?.addEventListener('abort', onAbort);
    const sondagem = window.setInterval(() => {
      if (Date.now() - inicio > PRAZO_MS) return fim(false);
      void fetch(`${opts.resultado ?? '/api/drive/auth/resultado'}?state=${encodeURIComponent(state)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ pronto: boolean; ok?: boolean }>) : null))
        .then((r) => {
          if (r?.pronto) fim(!!r.ok);
        })
        .catch(() => {});
    }, INTERVALO_MS);
  });
}
