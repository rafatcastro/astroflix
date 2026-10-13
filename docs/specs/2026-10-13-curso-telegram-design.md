# Curso a partir de um grupo do Telegram — design

**Data:** 2026-10-13

## Problema

Muitos cursos circulam em grupos e canais do Telegram: os vídeos são postados em ordem, com PDFs no
meio. Hoje, para assistir no Learnflix, é preciso baixar tudo à mão para uma pasta.

Objetivo: a pessoa cola o link do grupo, o app abre com a **conta Telegram dela** e o grupo vira um
curso, com o vídeo transmitido na hora (seek incluso) e o progresso confiável de sempre.

## Decisões

| Decisão | Escolha |
|---|---|
| Acesso | Conta da própria pessoa (MTProto), não bot: bot só baixa até 20 MB e não lê o histórico |
| Biblioteca | **GramJS** (`telegram` no npm): JS puro, entra no esbuild e no executável único. TDLib exigiria binário nativo por plataforma |
| Login | **QR code** dentro do app (Telegram do celular → Dispositivos → Conectar dispositivo), com a senha de duas etapas quando houver |
| Credencial do app | `api_id`/`api_hash` embutidos no build (`TELEGRAM_PADRAO`, de `.telegram.local.json` ou das envs `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`), com override em Configurações — mesma regra do Google |
| Sessão | `StringSession` no SQLite (`settings`), como o refresh token do Drive; **Desconectar** encerra também no Telegram |
| Ordem das aulas | A **ordem de postagem** do grupo |
| O que vira o quê | Vídeo (inclusive mandado "como arquivo") → aula; documento → material; o resto (texto, foto, figurinha, link) é ignorado |
| Tópicos de fórum | Fora desta etapa: o curso é uma lista única |
| Streaming | O servidor atende o `Range` do player baixando só os blocos de 512 KB que cobrem o trecho |
| Capas | A miniatura que o Telegram guarda com o vídeo (sem ffmpeg, sem baixar o vídeo) |

## Identidade da aula

O progresso nunca se prende ao ID do Telegram, mas ao `rel_path` (regra do repositório). Para o
Telegram, `rel_path = <id da mensagem, 10 dígitos>-<nome>.<ext>`:

- o ID da mensagem é estável e cresce na ordem de postagem, então a ordenação natural que o
  `deriveCourse` já faz dá a ordem do grupo;
- re-escanear não muda a identidade de nenhuma aula;
- `lessons.remote_id` guarda o ID da mensagem, que é o endereço para baixar.

Título da aula: a primeira linha da legenda; sem legenda, o nome do arquivo limpo; sem os dois,
"Vídeo de dd/mm/aaaa".

## Dados

Migração v3. O `CHECK (source IN ('local','drive'))` não pode ser alterado no SQLite, então a tabela
`courses` é reconstruída pelo procedimento oficial (nova tabela, cópia, troca, `foreign_key_check`),
com `source IN ('local','drive','telegram')` e a coluna nova `telegram_peer` (JSON
`{ tipo, id, accessHash }`: sem o access hash, um canal privado não é encontrado depois de reiniciar
o app).

## Links aceitos

- `t.me/nome` e `t.me/nome/123`: grupo ou canal público;
- `t.me/c/123456/789`: grupo privado em que a pessoa já está;
- `t.me/+hash` e `t.me/joinchat/hash`: convite. O app pergunta antes de entrar no grupo.

`telegram.me`, `https://` opcional e `@nome` também valem.

## Erros

| Situação | O que a pessoa vê |
|---|---|
| Sem conta conectada | O modal mostra o QR code |
| Não está no grupo / link privado inacessível | "Sua conta não está neste grupo. Entre pelo Telegram e tente de novo." |
| Convite | "Este é um convite. Entrar no grupo com a sua conta?" |
| Sessão caiu | "A conexão com o Telegram caiu" + **Conectar de novo** |
| Mensagem apagada | "Este vídeo foi removido do grupo"; o progresso fica |
| `FLOOD_WAIT_X` | o GramJS já espera sozinho as pausas de até 60 s; acima disso, "O Telegram pediu uma pausa de N min" |
| Sem vídeos | "Não achei vídeos neste grupo." |
| Sem rede | "Sem conexão com o Telegram." |

## Interface

- **Adicionar ▾ → Do Telegram** (e o botão na biblioteca vazia): modal com o campo do link. Sem
  conta, mostra o QR code e espera a conexão; com a senha de duas etapas, pede a senha ali mesmo.
- **Configurações → Telegram**: "Conectado como @fulano · Desconectar", e campos para usar um
  `api_id`/`api_hash` próprios.
- O player trata `nao-autorizado` com **Conectar de novo**, como no Drive.

## Opcional de verdade

Quem não usa Telegram nunca vê login nem configuração, e nada conecta ao Telegram até a pessoa colar
um link. O cliente GramJS só é criado sob demanda.

## Testes

TDD com o cliente do Telegram injetado (falso nos testes): links, montagem do curso a partir das
mensagens, alinhamento do `Range` em blocos, tradução de erros, migração v3 e rotas. A conexão real
é checagem manual: login por QR, grupo público, grupo privado, convite, seek, material, capa,
re-escanear e desconectar.

## Fora desta etapa

Tópicos de fórum como módulos, login por telefone, download offline e grupos em que o vídeo é só um
link externo.
