# Conta e nuvem (Supabase)

## Objetivo

Login **obrigatório** na abertura, com Google. A conta guarda na nuvem os metadados de quem usa
(cursos, aulas, progresso, bibliotecas e flashcards), e qualquer computador em que a pessoa entra
traz tudo de volta. A nuvem é a fonte da verdade; o SQLite local vira cache, para o app continuar
rápido e de pé quando a rede oscila.

Muda uma regra do projeto: até aqui "assistir funciona sem conta e sem rede". Passa a ser "precisa
de conta; sem rede, só abre com uma sessão já salva nesta máquina".

## Decisões (aprovadas na conversa)

- **Supabase, não Firebase.** Os dados são relacionais e já vivem num SQLite; o Postgres recebe o
  mesmo modelo, a regra por usuário fica no banco (RLS) e o app só embute a chave pública (anon).
- **Login: só Google**, reaproveitando o OAuth com PKCE do Drive (navegador do sistema, o mesmo
  cliente). O servidor troca o `id_token` do Google por uma sessão do Supabase
  (`signInWithIdToken`); no Supabase, o provedor Google tem o nosso Client ID em "Authorized
  Client IDs". Nenhum redirect novo.
- **Abordagem A: nuvem como fonte da verdade, SQLite como cache sincronizado.** As rotas atuais
  continuam lendo do SQLite; uma camada nova (`server/src/nuvem/`) sobe as escritas e desce as
  mudanças.

## Sessão

- Refresh token no SQLite (`settings`: `conta.sessao`), renovado sozinho. `GET /api/conta` →
  `{ entrou, email, ultimaSincronizacao, pendentes, erro }`.
- Sem sessão: a interface mostra só a **tela de entrada**; toda rota `/api` que não é de conta ou
  de saúde responde 401 `precisa-entrar` (a trava é no servidor, não só na tela).
- Offline com sessão salva: abre normalmente, com o cache.
- **Sair** (Configurações → Conta): apaga a sessão. **Outra conta** entrando nesta máquina: o cache
  de metadados da anterior é apagado antes (downloads e conversões ficam: são arquivos da máquina).
- **Primeira entrada** com dados locais (quem já usava o app): sobe tudo para a conta antes de
  sincronizar. Nada se perde.

## Dados na nuvem

Todas as tabelas com `user_id uuid default auth.uid()`, RLS "só o dono" e `atualizado_em`:

- `colecoes (id, nome, sort_index)`
- `cursos (id, titulo, origem, drive_folder_id, drive_resource_key, telegram_peer, estrutura,
  arquivado, sort_index, colecao_id, capa_rel_path, excluido)`; o `id` é o mesmo uuid do curso local
- `aulas (curso_id, rel_path, titulo, modulo, order_index, module_order, duracao_sec)`
- `progresso (curso_id, rel_path, posicao_sec, mais_longe_sec, duracao_sec, concluida,
  concluida_em, auto_concluida)`
- `flashcards (id, curso_id, aula_rel_path, minuto_sec, frente, verso, anki_note_id, excluido)`
- `pastas_por_maquina (curso_id, maquina_id, caminho)`: onde fica a pasta de um curso local em
  cada computador

Nunca sobem: downloads, conversões, capas geradas, sessões do Drive e do Telegram, configurações
do player, raízes permitidas.

## Sincronização

- **Subida:** gatilhos (triggers) no SQLite anotam em `nuvem_fila` cada mudança nas tabelas acima;
  um enviador manda em lotes (upsert) e repete o que falhar. Escrita que veio da própria
  sincronização desliga os gatilhos (sem eco).
- **Descida:** ao entrar, ao abrir e a cada 60 s, pede o que mudou desde a última marca
  (`atualizado_em`) e aplica no cache.
- **Conflito:** a nuvem vence; no **progresso**, vence quem foi mais longe (a regra do backup, em
  `backup/merge.ts`).
- **Exclusões:** marcadas (`excluido`), e propagadas.
- **Curso local noutra máquina:** aparece com a pasta ausente; "Re-apontar pasta…" grava o
  caminho desta máquina em `pastas_por_maquina`.

## Interface

- **Tela de entrada** em tela cheia (fundo escuro, marca, "Seus cursos e seu progresso em
  qualquer computador", **Entrar com Google**); durante o login, "Continue no navegador…" com
  Cancelar; falha com o motivo e **Tentar de novo**.
- **Configurações → Conta:** e-mail, última sincronização, alterações pendentes e **Sair**.
- Faixa no topo só quando a nuvem recusa (sessão expirada): "Entre de novo para continuar
  sincronizando".

## Configuração

`SUPABASE_URL` e `SUPABASE_ANON_KEY`, pelo mesmo caminho do Google: `.supabase.local.json` (fora
do git) ou envs, embutidos no `bundled.ts`; no CI, dos secrets. O SQL do schema e das regras fica
em `supabase/schema.sql`, para aplicar no SQL Editor.

## Testes

Cliente do Supabase com `fetch` injetável (como o Drive) e um Supabase falso em memória: fila,
eco, conflito de progresso, troca de conta, primeira subida, trava 401 sem sessão.

## Fora do escopo

Outros provedores de login, compartilhar cursos entre contas, sincronizar arquivos de vídeo,
tempo real (websocket): a descida a cada 60 s basta.
