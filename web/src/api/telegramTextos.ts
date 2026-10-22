// O que cada falha do Telegram diz à pessoa. Um lugar só para o modal, o player e as Configurações.
const TEXTOS: Record<string, string> = {
  'link-invalido': 'Cole o link de um grupo, canal ou bot do Telegram (t.me/…).',
  'nao-encontrado': 'Não achei esse grupo no Telegram. Confira o link.',
  'sem-acesso': 'Sua conta não está neste grupo. Entre pelo Telegram e tente de novo.',
  'convite-invalido': 'Este convite expirou ou não vale mais. Peça um link novo.',
  'aguardando-aprovacao': 'Pedido enviado: um administrador do grupo precisa aprovar sua entrada.',
  'sem-videos': 'Não achei vídeos nem fotos neste grupo.',
  removido: 'Este vídeo foi removido do grupo.',
  'nao-autorizado': 'A conexão com o Telegram caiu.',
  'sem-conexao': 'Sem conexão com o Telegram.',
  'sem-credenciais': 'O app do Telegram não está configurado. Configure um app próprio em Configurações → Telegram.',
};

export function mensagemErroTelegram(erro: string, esperaSeg?: number): string {
  if (erro === 'flood') {
    const min = Math.max(1, Math.ceil((esperaSeg ?? 60) / 60));
    return `O Telegram pediu uma pausa de ${min} min. Tente de novo depois.`;
  }
  return TEXTOS[erro] ?? 'Não foi possível falar com o Telegram. Tente novamente.';
}
