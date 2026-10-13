# Curso do Telegram — plano de implementação

**Spec:** `docs/specs/2026-10-13-curso-telegram-design.md`
**Execução:** direto na sessão (pedido de agilidade), com revisão do conjunto no fim.

## Tarefa 1 — Núcleo puro (TDD)

`server/src/telegram/`:

- `tipos.ts`: `FalhaTelegram(tipo, esperaSeg?)`, `CredenciaisTelegram`, `LinkTelegram`, `Peer`,
  `MensagemTelegram` (o recorte de uma mensagem que o resto do app usa).
- `link.ts`: `parseLinkTelegram(texto): LinkTelegram | null`.
- `mensagens.ts`: `montarCurso(mensagens): { videos, materials }`, com o `rel_path` da spec.
- `blocos.ts`: `planoDeBlocos(start, end, tamanho)`: offset alinhado em 512 KB, quantos bytes pular
  no primeiro bloco e quantos entregar.
- `status.ts`: `statusDaFalhaTelegram(tipo)` e `falhaDoErro(e)`, que traduz os erros RPC do GramJS
  (`CHANNEL_PRIVATE`, `AUTH_KEY_UNREGISTERED`, `FLOOD_WAIT_X`…).
- `credenciais.ts`: precedência Configurações → env → `TELEGRAM_PADRAO`.

## Tarefa 2 — Banco

Migração v3 com a reconstrução de `courses` (`source` com `telegram`, `telegram_peer`). Teste: banco
v2 com curso, aula, progresso e biblioteca sobe para v3 sem perder nada, e o cascade continua.

## Tarefa 3 — Cliente, login e ingestão

- `cliente.ts`: a interface `ClienteTelegram` (resolver link, entrar por convite, ler o histórico,
  baixar blocos, miniatura, sessão) e `gramjs.ts`, a implementação real.
- `auth.ts`: login por QR com estado consultável (`aguardando` → `senha` → `conectado` | `erro`).
- `servicos.ts`: um cliente sob demanda, recriado quando a sessão ou a credencial mudam.
- `scan/scan-telegram.ts`: criar e reconciliar o curso, com as capas em segundo plano.

## Tarefa 4 — Rotas

`routes/telegram.ts` (cursos, convite, status, login, senha, desconectar, credenciais) e o ramo
`telegram` em stream, materiais, capas, re-escanear, re-apontar (recusado), conversão (recusada),
lições e backup.

## Tarefa 5 — Interface

`api/client.ts`, `TelegramLinkModal.tsx` (link, QR, senha, convite), item no menu Adicionar e na
biblioteca vazia, seção em Configurações, erro do player.

## Tarefa 6 — Build, CI e documentação

`gerar-bundled.mjs` com `TELEGRAM_PADRAO`, secrets na CI, `.gitignore`, `PRIVACY.md`, README e
`AGENTS.md`. Verificação: `pnpm test && pnpm build` e o app empacotado.
