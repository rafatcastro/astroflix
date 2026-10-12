// Autorização do Google pelo popup: um único lugar para o modal de link e para o player, que
// precisam do mesmo fluxo (abrir popup, esperar o postMessage da página de callback).

export const TEXTOS_ERRO_DRIVE: Record<string, string> = {
  'sem-acesso': 'Sua conta Google não tem acesso a esta pasta. Peça acesso ao dono do link.',
  'link-invalido': 'Cole o link de uma pasta do Google Drive.',
  'nao-e-pasta': 'Cole o link de uma pasta do Google Drive.',
  'cota-esgotada': 'O Google bloqueou downloads desta pasta por excesso de acessos. Tente de novo em algumas horas.',
  'sem-conexao': 'Sem conexão com o Google Drive.',
  'nao-autorizado': 'A autorização do Google expirou.',
  'sem-credenciais': 'O app do Google não está configurado. Configure um app próprio em Configurações → Google Drive.',
};

export const mensagemErroDrive = (erro: string): string =>
  TEXTOS_ERRO_DRIVE[erro] ?? 'Não foi possível falar com o Google Drive. Tente novamente.';

// Resolve true se a página de callback avisou sucesso; false se falhou, foi cancelada (popup
// fechado) ou abortada. O callback só posta para o próprio origin, então checamos `origin` para
// que uma página qualquer não consiga fingir uma autorização.
export function autorizarNoGoogle(
  url: string,
  opts: { onBloqueado?: () => void; signal?: AbortSignal } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const popup = window.open(url, 'learnflix-drive', 'width=500,height=650');
    let fechamento = 0;
    let sondagem = 0;
    // O link de fallback abre numa aba que pode não ter opener (postMessage some); o
    // callback também avisa por aqui, que alcança qualquer aba da mesma origem.
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel('learnflix-drive');
    } catch {
      canal = null;
    }
    const fim = (ok: boolean) => {
      window.removeEventListener('message', onMessage);
      canal?.close();
      window.clearInterval(fechamento);
      window.clearInterval(sondagem);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onMessage = (e: MessageEvent) => {
      // BroadcastChannel não tem origin (e já é só da mesma origem); `message` tem.
      if (e.origin && e.origin !== window.location.origin) return;
      const d = e.data as { tipo?: string; ok?: boolean } | null;
      if (!d || d.tipo !== 'learnflix-drive') return;
      fim(!!d.ok);
    };
    const onAbort = () => fim(false);
    window.addEventListener('message', onMessage);
    if (canal) canal.onmessage = onMessage;
    opts.signal?.addEventListener('abort', onAbort);
    if (popup) {
      // Fechar o popup sem concluir não manda mensagem; sem isto o botão ficaria preso em "Lendo…".
      fechamento = window.setInterval(() => {
        if (!popup.closed) return;
        // A página de callback posta e se fecha em seguida: dá uma folga para a mensagem chegar antes de desistir.
        window.clearInterval(fechamento);
        window.setTimeout(() => fim(false), 800);
      }, 500);
    } else {
      // Popup bloqueado: quem chamou mostra um link para abrir a autorização em outra aba; a
      // mensagem de volta continua sendo ouvida.
      opts.onBloqueado?.();
      // Último recurso se nem mensagem nem canal chegarem: perguntar ao servidor se a conta conectou.
      sondagem = window.setInterval(() => {
        void fetch('/api/drive/status')
          .then((r) => (r.ok ? (r.json() as Promise<{ conectado?: boolean }>) : null))
          .then((st) => {
            if (st?.conectado) fim(true);
          })
          .catch(() => {});
      }, 1500);
    }
  });
}
