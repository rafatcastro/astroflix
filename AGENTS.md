# AGENTS.md

Orientações para agentes de código (Claude Code, Codex e afins) trabalharem neste repositório.

## O que é

**Learnflix** é um app local para assistir cursos em vídeo guardados em pastas do disco, com
progresso confiável. Cada pasta escolhida vira um "curso"; o app escaneia, lista as aulas (com
módulos, materiais, duração e capas), transmite o vídeo por HTTP Range e guarda posição e conclusão
no SQLite. Cursos podem ser agrupados em **bibliotecas** (coleções).

O Learnflix é distribuído como **app desktop** (Tauri, em `desktop/`): quem usa baixa o instalador
da release e não precisa de terminal nem de Node. A janela sobe o próprio servidor como sidecar e
carrega a interface dele. Assistir cursos locais funciona sem conta, sem rede e sem serviço externo.
Recursos que usam rede (por exemplo, baixar uma pasta do Google Drive) são **opcionais**: quem não
usa nunca precisa configurar nada para eles, e nenhuma mudança pode transformá-los em pré-requisito
do resto do app.

O código e os comentários estão em **português**. Os comentários explicam o **porquê** (o caso que
motivou a decisão), não o quê. Siga esse estilo.

**Commits e push:** não há padrão obrigatório de mensagem de commit (prefixos como `feat:` são
opcionais), e pode fazer commit e **push direto na `main`**, sem branch nem Pull Request.

## Comandos

Node >= 22.5 e **pnpm** (gerenciador padrão; `packageManager` no package.json). Monorepo com três
workspaces (`pnpm-workspace.yaml`): `server`, `web` e `desktop`. Para o app desktop, também o Rust
(rustup; no Homebrew ele é keg-only, então `export PATH="$(brew --prefix rustup)/bin:$PATH"`).

```bash
pnpm install               # primeira vez
pnpm dev                   # janela do Tauri sobre o Vite (:5173, /api → :7777) + Fastify, hot reload
pnpm build                 # web → gerar-bundled → tipos do server → esbuild → dist/learnflix.cjs
pnpm start                 # roda dist/learnflix.cjs (precisa do build antes)
pnpm test                  # testes do server e da web
pnpm build:binario         # executável único (Node SEA, ~110 MB) para esta máquina; precisa do build
pnpm desktop:build         # instalador desta máquina em desktop/src-tauri/target/release/bundle
pnpm repo                  # audita onde o nome do repositório GitHub aparece
pnpm repo dono/repo        # troca o repositório em package.json, README.md e tauri.conf.json
```

Um teste só:

```bash
pnpm --filter server test src/scan/derive.test.ts
```

**Não há script separado de typecheck nem de lint.** O `tsc --noEmit` roda dentro do `build` de
cada workspace. O servidor nunca emite JS: roda via `tsx` em dev e é empacotado pelo esbuild
(`scripts/empacotar.mjs`) no build. Os imports são ESM **sem extensão de arquivo**
(`moduleResolution: "Bundler"`).

O pacote não é publicado no npm (`"private": true`). As releases saem de
`.github/workflows/release.yml`, disparado por **todo push na `main`** que não seja só de
documentação; a versão é automática (`major.minor` do `package.json` + `GITHUB_RUN_NUMBER`), então
ninguém cria tag à mão. Um runner por plataforma gera o sidecar
(`build:binario` → `scripts/preparar-sidecar.mjs`, que dá o nome com o target triple do Rust), a
versão é gravada no `package.json`, no `tauri.conf.json` e no `Cargo.toml`
(`scripts/sincronizar-versao.mjs <versão>`) e o `tauri-action` anexa os instaladores e o `latest.json` do
atualizador a uma release em rascunho, publicada só no fim. Secrets: `GOOGLE_*`, `TELEGRAM_*` e
`TAURI_SIGNING_PRIVATE_KEY` (a chave fica localmente em `.tauri-signing.local.key`, ignorada pelo
git; a pública está no `tauri.conf.json`).

**No macOS, o sidecar precisa dos entitlements de JIT** (`desktop/src-tauri/Entitlements.plist`): o
Tauri o reassina com Hardened Runtime, e sem `allow-jit` o V8 morre com SIGTRAP antes de imprimir
qualquer coisa.

## Variáveis de ambiente

Lidas em `server/src/config.ts`:

- `PORT`: padrão 7777. Se estiver ocupada, o app anda para a próxima (ver `listen.ts`).
- `BIND`: padrão 127.0.0.1.
- `DATA_DIR`: padrão `~/.learnflix`, ou `%LOCALAPPDATA%\Learnflix` no Windows. Guarda `app.db`,
  `thumbs/` e `converted/`.
- `ALLOWED_ROOTS`: separado por `:` ou `;`. O padrão é a home do usuário, mais `/Volumes` no macOS,
  `/media` e `/mnt` no Linux, e as unidades detectadas sob demanda no Windows (`roots.ts`).
- `AUTOCOMPLETE_THRESHOLD`: padrão 0.9.

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: opcionais, só para cursos do Telegram. Mesma
  precedência e mesma regra de segredo das `GOOGLE_*`: `telegram.credenciais` → env →
  `TELEGRAM_PADRAO` (de `.telegram.local.json`, ignorado pelo git; no CI, dos secrets).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`: opcionais, só para cursos do Google
  Drive. Precedência, campo a campo: Configurações (`drive.credenciais`) → env → `GOOGLE_PADRAO`, embutido no
  `bundled.ts` por `scripts/gerar-bundled.mjs` a partir dessas mesmas envs ou de
  `.google-oauth.local.json`. Esse arquivo é ignorado pelo git e **nunca** é commitado (o repositório
  é público e o push protection do GitHub barra segredos do Google). No CI vêm dos secrets.

O servidor nunca abre o navegador: **a interface só roda na janela do app desktop** (não há mais
modo navegador). Ao subir, ele acrescenta ao PATH os lugares comuns do ffmpeg (app aberto pelo Dock
não herda o PATH do terminal) e escreve `LEARNFLIX_URL=<url>` na saída padrão, a linha que o
`lib.rs` espera para navegar a janela (`server/src/desktop.ts`).

## Arquitetura

**A divisão cliente/servidor existe porque uma página web (a interface, dentro da webview) não lê
caminhos arbitrários do disco.** O
servidor Fastify lê as pastas (sempre só-leitura), transmite o vídeo, gera as miniaturas e é dono do
SQLite. A SPA React conversa com ele por uma API JSON.

### Servidor (`server/src`)

- `index.ts`: bootstrap, nesta ordem: `quiet` (tem de ser o **primeiro import**), config, herança
  do v1, PATH do ffmpeg, diretórios, `openDb`, `buildApp`, `escutarComFallback`, banner e a linha
  `LEARNFLIX_URL=`.
- `app.ts`: `buildApp(config, db)` monta o Fastify. Primeiro registra a guarda, depois os plugins
  de rota. **Rota nova entra aqui, no marcador `// [ROUTES]`.**
- `guarda.ts`: a fronteira contra páginas da internet abertas no navegador da pessoa (o servidor
  escuta em localhost, e qualquer página aberta no navegador consegue tentar falar com ele). Recusa
  `Host` que não seja localhost ou um IP literal (contra DNS rebinding) e `Origin` de fora desta máquina em
  requisições que mudam estado (contra CSRF). Toda rota nova herda essa proteção. Não contorne.
- `spa.ts`: serve a interface a partir de `bundled.ts` (base64 embutido no build), com fallback para
  a casca em URLs que não começam com `/api`. **Nada é lido do disco.** No v1 a SPA era procurada
  relativa ao `cwd` e sumia se o processo subisse de outro lugar.
- `bundled.ts`: **gerado** por `scripts/gerar-bundled.mjs` (interface + versão). Não versionado,
  não editar à mão. `pnpm dev`, `pnpm test` e `pnpm build` o regeneram.
- `db/`: `openDb` liga WAL e foreign keys e roda `migrate`, guardado por **`PRAGMA user_version`**.
  Para evoluir o schema, **acrescente um bloco `if (version < N)`**. Nunca edite o `SCHEMA_V1`. O
  SQLite é o do próprio Node (`node:sqlite`), sem módulo nativo. Ele entra por `require()` e não por
  import estático, para o aviso de "experimental" poder ser filtrado (`quiet.ts`). Faltam os
  açúcares do better-sqlite3, então use os helpers **`pragma(db, ...)`** e **`transaction(db, fn)`**
  daqui. O segundo aninha com SAVEPOINT, porque o import chama `createCourseFromPath`, que já abre a
  sua.
- `db/legacy.ts`: adota o banco do v1 quando o app sobe de dentro da pasta antiga. Nunca
  sobrescreve.
- `backup/`: export/import da biblioteca. `format` (envelope + validação), `export`, `identify`
  (mesmo curso por caminho ou por impressão digital das aulas), `merge` (vence quem foi mais longe)
  e `import` (`planImport` puro + `applyImport`). Exposto por `routes/backup.ts`.
- `drive/`: cursos do Google Drive (rede opcional, sempre `fetch` injetável nos testes). `link`
  extrai o ID da pasta, `api` é o cliente da Drive API com retry, `auth` faz OAuth com PKCE (o login
  abre no navegador do sistema; a janela pergunta o resultado por `/api/drive/auth/resultado`,
  pelo `state`), `walk` lista a pasta, `stream` repassa o `Range` do vídeo, `status`/`tipos`
  mapeiam os erros, `credenciais` resolve a precedência acima e `servicos` monta tudo para as rotas.
  `routes/drive.ts` expõe a API e `scan/scan-drive.ts` ingere a pasta como `scan-course` faz com a
  local.
- `telegram/`: cursos do Telegram, com a **conta da pessoa** (MTProto, GramJS). Tudo do GramJS
  fica em `gramjs.ts` (importado sob demanda: nada conecta até alguém colar um link); o resto do
  app só conhece `ClienteTelegram` e `ServicosTelegram`, e os testes injetam falsos
  (`buildApp(..., { telegram })`). `link` interpreta `t.me/…`, `mensagens` monta o curso (o
  `rel_path` começa pelo id da mensagem com 10 dígitos, que dá a ordem de postagem e não muda),
  `blocos` alinha o `Range` em blocos de 512 KB, `status` traduz os erros RPC e `stream` repassa
  o vídeo. Login por QR com estado em memória (`/api/telegram/login`). `routes/telegram.ts` e
  `scan/scan-telegram.ts` espelham o Drive. O `telegram_peer` do curso guarda o access hash: sem
  ele, um canal privado não é achado depois de reiniciar.
- `media/`: `ffmpeg.ts` detecta ffmpeg/ffprobe e `thumbs.ts` gera as capas.
- `listen.ts`, `banner.ts`, `desktop.ts`: porta ocupada, mensagem de boot, PATH do ffmpeg e a linha
  `LEARNFLIX_URL=`.
- `routes/`: um plugin por arquivo. SQL cru com prepared statements do `node:sqlite`, mapeando as
  linhas snake_case para DTOs camelCase à mão. `stream.ts` implementa o parsing de HTTP Range (é o
  que faz o seek funcionar). O `isWithinRoots` do `fs.ts` é a fronteira de segurança da navegação de
  pastas, reaproveitada por `courses.ts`, `materials.ts` e afins.
- `scan/`: a ingestão.
  - `walk.ts` percorre a pasta separando vídeos de materiais e ignorando dotfiles.
  - `derive.ts` transforma a lista de arquivos em aulas ordenadas e módulos (`modules` se algum
    vídeo estiver aninhado, senão `flat`), com títulos limpos a partir do nome do arquivo.
  - `natural-sort.ts` ordena com consciência numérica (`Intl.Collator`).
  - `scan-course.ts` junta tudo numa transação só.
  - `reconcile.ts` e `repoint-prefix.ts` cuidam de re-escanear e re-apontar.

### Desktop (`desktop/`)

- `src-tauri/src/lib.rs`: instância única, sobe o sidecar `learnflix-server`, lê o stdout até
  `LEARNFLIX_URL=` e navega a janela; em 20 s sem a linha, ou se o servidor morrer, mostra a tela de
  erro (`carregando/index.html?erro=`) com "Tentar de novo" (comando `reiniciar`). Mata o sidecar ao
  sair. Cada subida tem uma geração: eventos de um processo antigo não mexem mais na janela.
- `capabilities/interface.json` libera opener, updater e process para a origem `http://localhost:*`
  (a interface vem do servidor, não do bundle).
- Na interface, `web/src/lib/desktop.ts` (`abrirFora`, `cliqueFora`) leva para fora da webview:
  login do Google e downloads abrem no navegador do sistema (o Google bloqueia OAuth em webview), e `AvisoAtualizacao.tsx` oferece a versão nova (parando o servidor antes de
  instalar: no Windows o instalador fecha o app sem `RunEvent::Exit`).
- Em `pnpm dev` (`tauri dev` com `tauri.dev.conf.json`) não há sidecar: a janela abre o Vite e o
  servidor roda pelo `tsx watch` (`pnpm dev:servicos`). `tauri::is_dev()` pula a subida do sidecar.

### Modelo de dados (SQLite)

O schema fica em `server/src/db/schema.ts` e os tipos de linha em `server/src/types.ts`.

**Princípio central: o progresso nunca se prende a um caminho absoluto.** O curso tem um `id`
interno estável e a aula é identificada pelo `rel_path` dentro do curso. Mover a pasta de origem e
re-apontar preserva o histórico.

- `courses.source` (`'local'` | `'drive'` | `'telegram'`) distingue a origem; aulas remotas
  guardam o ID do arquivo (Drive) ou da mensagem (Telegram) em `lessons.remote_id`. A v3
  reconstruiu `courses` para o CHECK aceitar `telegram` (o SQLite não altera CHECK). O progresso continua preso ao `rel_path`, nunca ao ID do Drive,
  então re-escanear depois de o dono reenviar o arquivo preserva o histórico.
- `progress` é uma tabela por aula, com `position_sec`, `furthest_sec` e
  `completed`/`auto_completed`.
- As aulas são apagadas em cascata.
- `courses.poster_lesson_id` aponta para a aula da capa.
- `courses.collection_id` é `ON DELETE SET NULL`: excluir a biblioteca preserva os cursos.

### Web (`web/src`)

React 18 + Vite 6 + TanStack Query 5 + React Router 7 + Tailwind 3.

- `main.tsx`: providers (QueryClient, BrowserRouter).
- `App.tsx`: quatro rotas: `/` (Library), `/course/:id` (Course), `/lesson/:id` (Lesson) e
  `/settings` (Settings).
- `api/client.ts`: o único cliente HTTP tipado (`api.*`) e todas as interfaces de DTO, espelhando o
  servidor.
- `api/hooks.ts`: wrappers do TanStack Query. As mutations invalidam `['courses']` e
  `['course', id]`.
- `pages/`:
  - Library: grade de cursos, bibliotecas, adicionar pasta e importação em lote.
  - Course: lista de aulas, retomar e menu ⋯.
  - Lesson: player 100vh sem distração, salvar progresso, concluir e atalhos de teclado.
  - Settings.
- `components/DirPicker.tsx` conduz o seletor de pastas via `/api/fs/browse`.

## Convenções

- **TDD na lógica de verdade** (scan/derive, parsing de Range, migrações, config, backup, guarda)
  com Vitest. Os testes de rota usam `app.inject(...)` do Fastify. Os testes que dependem do ffmpeg
  são guardados por uma checagem de capacidade (`it.skipIf(!hasFfmpeg())`).
- ffmpeg/ffprobe são **opcionais**. Capas, duração e conversão degradam com elegância
  (placeholder, 404, aviso claro) quando faltam.
- A interface é verificada por build e checagem manual, não por testes de UI.

## Design da interface

O design é governado por dois documentos em `docs/`. **Leia os dois antes de mexer na UI.**

- [`docs/product.md`](docs/product.md): estratégia, público e voz do produto.
- [`docs/design.md`](docs/design.md): o sistema visual, com cores, tipografia, componentes e estados.

Resumo do que eles definem:

- **Registro `product`**: o design serve à tarefa. O conteúdo (vídeo, capas) é o protagonista e a
  interface recua.
- **Personalidade "cinema pessoal"**: imersivo, confiável, sem ruído. Espírito Plex/Jellyfin, nunca
  chamativo.
- **Princípios**:
  - conteúdo primeiro;
  - confiança no progresso acima de tudo;
  - restrição deliberada (sem gradiente, vidro ou movimento gratuitos);
  - acabamento de produto em todos os estados (vazio, carregando, erro, sem ffmpeg, formato não
    tocável);
  - rápido, local e com o teclado em primeiro plano.
- **Evitar**: SaaS genérico "feito por IA", LMS corporativo pesado, ornamento decorativo, player com
  cara de amador.
- **Acessibilidade**: contraste ≥ 4.5:1 no corpo (atenção ao fundo `#0a0a0a`), foco visível,
  navegação completa por teclado e respeito a `prefers-reduced-motion`.
