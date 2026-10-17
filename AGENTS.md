# AGENTS.md

Orientações para agentes de código (Claude Code, Codex e afins) trabalharem neste repositório.

## O que é

**Astroflix** é um app local para assistir cursos em vídeo guardados em pastas do disco, com
progresso confiável. Cada pasta escolhida vira um "curso"; o app escaneia, lista as aulas (com
módulos, materiais, duração e capas), transmite o vídeo por HTTP Range e guarda posição e conclusão
no SQLite. Tudo se organiza em **categorias** (a tabela `collections`, que antes eram as bibliotecas de
cursos): o menu principal lista as categorias (a última aberta primeiro) e cada uma tem as abas
Cursos, PDFs e Questões (flashcards do Anki), sem outra divisão dentro (o antigo "tipo" do PDF
não aparece mais). A categoria tem nome e emoji (v9), editados pelo lápis no cabeçalho dela ou pelo
botão direito no cartão (`DialogoCategoria.tsx`); o lápis em "Sem categoria" a transforma numa
categoria com tudo o que estava sem.

O Astroflix é distribuído como **app desktop** (Tauri, em `desktop/`): quem usa baixa o instalador
da release e não precisa de terminal nem de Node. A janela sobe o próprio servidor como sidecar e
carrega a interface dele. **O app exige conta** (login com Google, sessão no Supabase): a nuvem
guarda os metadados da pessoa (cursos, aulas, progresso, bibliotecas e flashcards) e o SQLite local
é o cache. Sem rede, o app abre só com uma sessão já salva nesta máquina. Build sem projeto Supabase
(fork, desenvolvimento) roda sem conta. Os outros recursos de rede (Drive, Telegram, Anki) continuam
**opcionais**: quem não usa nunca precisa configurar nada para eles.

**Nome:** o app se chamava Learnflix e virou **Astroflix** (repositório `rafatcastro/astroflix`; o
GitHub redireciona o nome antigo, então o atualizador de quem tem uma versão velha continua achando
as releases). Ficaram com o nome antigo, de propósito, os identificadores que dão continuidade: o
`identifier` do Tauri, a pasta de dados (`~/.learnflix`, `%LOCALAPPDATA%\Learnflix`), o formato do
backup (`learnflix-library`), o tipo de nota "Learnflix" do Anki, o sidecar `learnflix-server` e a
linha `LEARNFLIX_URL=`. Os baralhos `Learnflix::…` são movidos sozinhos para `Astroflix::…`.

O código e os comentários estão em **português**. Os comentários explicam o **porquê** (o caso que
motivou a decisão), não o quê. Siga esse estilo.

**Commits e Pull Requests:** não há padrão obrigatório de mensagem de commit (prefixos como `feat:`
são opcionais). **Não faça push direto na `main`**: cada push nela dispara uma release (~10 min, em
fila), e vários pushes seguidos viravam uma fila de releases. Trabalhe numa branch, abra um Pull
Request para a `main` (`gh pr create -R rafatcastro/astroflix`) e deixe o merge para a pessoa: o
merge é o que gera a release, uma por vez. O PR roda `.github/workflows/verificar.yml` (`pnpm
build`).

## Comandos

Node >= 22.5 e **pnpm** (gerenciador padrão; `packageManager` no package.json). Monorepo com três
workspaces (`pnpm-workspace.yaml`): `server`, `web` e `desktop`. Para o app desktop, também o Rust
(rustup; no Homebrew ele é keg-only, então `export PATH="$(brew --prefix rustup)/bin:$PATH"`).

```bash
pnpm install               # primeira vez
pnpm dev                   # janela do Tauri sobre o Vite (:5173, /api → :7777) + Fastify, hot reload
pnpm build                 # web → gerar-bundled → tipos do server → esbuild → dist/learnflix.cjs
pnpm start                 # roda dist/learnflix.cjs (precisa do build antes)
pnpm build:binario         # executável único (Node SEA, ~110 MB) para esta máquina; precisa do build
pnpm desktop:build         # instalador desta máquina em desktop/src-tauri/target/release/bundle
pnpm run repo              # audita onde o nome do repositório GitHub aparece (o `pnpm repo` puro é um comando do próprio pnpm)
pnpm run repo dono/repo    # troca o repositório em package.json, README.md e tauri.conf.json
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
atualizador a uma release em rascunho, publicada só no fim. Secrets: `GOOGLE_*`, `TELEGRAM_*`, `SUPABASE_*` e
`TAURI_SIGNING_PRIVATE_KEY` (a chave fica localmente em `.tauri-signing.local.key`, ignorada pelo
git; a pública está no `tauri.conf.json`).

**No macOS, o sidecar precisa dos entitlements de JIT** (`desktop/src-tauri/Entitlements.plist`): o
Tauri o reassina com Hardened Runtime, e sem `allow-jit` o V8 morre com SIGTRAP antes de imprimir
qualquer coisa.

## Variáveis de ambiente

Lidas em `server/src/config.ts`:

- `PORT`: padrão 7777. Se estiver ocupada, o app anda para a próxima (ver `listen.ts`).
- `BIND`: padrão 127.0.0.1.
- `DATA_DIR`: padrão `~/.learnflix`, ou `%LOCALAPPDATA%\Astroflix` no Windows. Guarda `app.db`,
  `thumbs/`, `converted/` e `downloads/` (cópias dos cursos do Drive).
- `ALLOWED_ROOTS`: separado por `:` ou `;`. O padrão é a home do usuário, mais `/Volumes` no macOS,
  `/media` e `/mnt` no Linux, e as unidades detectadas sob demanda no Windows (`roots.ts`).
- `AUTOCOMPLETE_THRESHOLD`: padrão 0.9.

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`: o projeto da conta. Env → `SUPABASE_PADRAO` (de
  `.supabase.local.json`, ignorado pelo git; no CI, dos secrets). A chave é a publishable (pública
  por desenho; quem protege os dados é a RLS de `supabase/schema.sql`). Sem as duas, o app roda sem
  conta.
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
  não editar à mão. `pnpm dev` e `pnpm build` o regeneram.
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
  local. Colar o link cria o curso assim que a raiz responde; a listagem continua em segundo plano
  (`importacaoDrive`). **Abrir uma aula** (`GET /api/lessons/:id` → `baixador.pedirAula`) baixa
  ela e as `JANELA` (2) seguintes não concluídas (`baixar.ts`, uma fila, retomando `.part` com
  Range), nunca o curso inteiro: a primeira versão baixava tudo e um curso passou de 40 GB. Vai
  para `DATA_DIR/downloads/<curso>/<id da aula>` (`local.ts`)
  e convertida se não tocar (`media/preparar.ts`, mesma fila de recodificação do player). Stream e
  materiais preferem o arquivo local; o que ainda não chegou vem do Drive (materiais não são
  baixados). Ao abrir, o app só limpa as concluídas (`buildApp(..., { retomarDownloads })`, só no
  `index.ts`), sem baixar nada. Aula concluída tem a
  cópia apagada (menos a assistida por último) e não é rebaixada; o banco guarda os metadados.
  O **"Baixar para Downloads"** do menu ⋯ do curso é outra coisa: `drive/exportar.ts` copia o curso inteiro
  (aulas e materiais, Drive ou Telegram) para a pasta Downloads do sistema (`downloads.ts`:
  registro no Windows, `xdg-user-dir` no Linux), com os nomes reais, numa fila própria; o que
  já está lá com o mesmo tamanho é pulado, e o app nunca mais mexe nessa pasta.
- `telegram/`: cursos do Telegram, com a **conta da pessoa** (MTProto, GramJS). Tudo do GramJS
  fica em `gramjs.ts` (importado sob demanda: nada conecta até alguém colar um link); o resto do
  app só conhece `ClienteTelegram` e `ServicosTelegram`, e os testes injetam falsos
  (`buildApp(..., { telegram })`). `link` interpreta `t.me/…`, `mensagens` monta o curso (o
  `rel_path` começa pelo id da mensagem com 10 dígitos, que dá a ordem de postagem e não muda),
  `blocos` alinha o `Range` em blocos de 512 KB, `status` traduz os erros RPC, `stream` repassa
  o vídeo e `baixar` entra na mesma fila de download do Drive (`fonteDoTelegram`; retomar volta ao
  último bloco inteiro). Login por QR com estado em memória (`/api/telegram/login`). `routes/telegram.ts` e
  `scan/scan-telegram.ts` espelham o Drive. O `telegram_peer` do curso guarda o access hash: sem
  ele, um canal privado não é achado depois de reiniciar.
- `anki/`: flashcards com o Anki da pessoa, pelo add-on **AnkiConnect** (`127.0.0.1:8765`; o
  AnkiWeb não tem API pública). Quem chama é o servidor. `cliente` fala o protocolo (tipo de nota
  próprio "Astroflix", porque o "Básico" muda de nome com o idioma), `texto` converte texto ↔ HTML
  dos campos e monta o baralho (`baralhoDe`: `Astroflix::<categoria>` para as gerais da categoria,
  `…::Cursos::<curso>` e `…::PDFs::<PDF>` embaixo; sem categoria, `Astroflix::Sem categoria`; o
  geral sem categoria, `Astroflix`). `flashcards.baralho` é onde o card está no Anki: o que
  difere do baralho pedido (renomeou, mudou de categoria, ou veio da estrutura antiga
  `Astroflix::Cursos`) é movido com `changeDeck`, e o baralho antigo que ficou vazio sai, `servicos` é o espelho local
  (tabela `flashcards`, v4) com a fila de pendentes: o Anki é a fonte da verdade, mas criar com ele
  fechado funciona e vai depois. Ao listar, relê as notas (edição lá vem para cá, nota apagada sai;
  se **nenhuma** for achada, assume outro perfil e não apaga nada). `routes/flashcards.ts` expõe a
  API.
- `nuvem/`: conta e sincronização. `cliente` fala com o Supabase por REST (`fetch` injetável),
  `conta` faz o login (o OAuth com PKCE do Drive, `openid email profile` mais `drive.readonly`: o Drive é pedido já na entrada e, se a pessoa o deixa marcado, vira a conexão do Drive (`aoConcederDrive` → `auth.adotar`); desmarcado, os menus mostram "Conectar o Google Drive" no lugar de importar; trocado por sessão do
  Supabase com `id_token`; sessão em `settings`), `sincronizar` sobe a `nuvem_fila` (preenchida por
  gatilhos da v5, calados quando quem escreve é a descida) e desce o que o banco carimbou depois da
  última marca de cada tabela. Conflito: a nuvem vence, mas o progresso nunca anda para trás e
  "concluída" vale a escolha mais recente (a mesma regra em `supabase/schema.sql`). A pasta de um
  curso local é de cada máquina (`pastas_por_maquina`). Outra conta na mesma máquina limpa o cache;
  a primeira entrada sobe tudo. `buildApp(..., { exigirConta })` (só no `index.ts`) liga a trava
  (401 `precisa-entrar` em toda rota fora de `/api/conta`) e a sincronização a cada minuto; 
  O schema do Postgres fica em
  `supabase/schema.sql` (aplicar no SQL Editor; idempotente, rodar de novo a cada tabela nova).
- `routes/documentos.ts`: a estante de **PDFs** (livros, questões, apostilas; tabela `documentos`,
  v6). Cada PDF é um arquivo do disco que o app só lê: adicionar arquivos ou uma pasta (com
  subpastas, com teto de profundidade), categoria em texto livre, página onde parou, lido
  (automático na última página), re-apontar e remover (o arquivo fica). O arquivo sai por
  `servirArquivo` com Range, dentro das raízes permitidas. A capa (primeira página) e o número de
  páginas são desenhados pela interface com o pdf.js e enviados de volta (`PUT .../capa`): no
  servidor seria outra dependência só para isso. Sobe para a conta como os cursos
  (`documentos` + `documentos_por_maquina` no `schema.sql`); um projeto sem essas tabelas (404)
  deixa os PDFs na fila sem travar a sincronização dos cursos. **PDF do Google Drive** (v8:
  `origem='drive'`, `drive_id`, `drive_resource_keys`): `POST /api/documentos/drive` com o link
  de um arquivo ou de uma pasta (`drive/pdfs.ts` lista os PDFs, subpastas e atalhos inclusive);
  o arquivo é repassado do Drive por Range (`repassarDoDrive`), sem cópia no disco, com o mesmo
  login do Google dos cursos. Para escolher sem colar link, `GET /api/drive/navegar?pasta=`
  (`root`, `compartilhados` ou o id) lista pastas e PDFs com a conta Google conectada
  (`SeletorDrive.tsx`); o Google Picker não serve, porque o login do Google é recusado na webview.
- `routes/estudo.ts`: o painel de estudo (v10). `pomodoros` guarda cada foco concluído;
  `tempo_aula`, os segundos de aula assistidos por máquina, dia e curso (o id junta os três, então
  máquinas não disputam o número; a nuvem só deixa crescer). `dia` é a data local. O timer roda na
  interface (`web/src/lib/pomodoro.tsx`, estado com a hora do fim da fase no localStorage): na pausa,
  a aula para e não toca (`BloqueioDaPausa`) até acabar ou ser pulada; o fim da pausa espera a
  pessoa começar o próximo foco.
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
  login do Google e downloads abrem no navegador do sistema (o Google bloqueia OAuth em webview), e `AtualizacaoInicial.tsx`, na abertura, procura a versão nova e a instala sozinho com uma barra
  (falhou: segue para o app e tenta na próxima abertura; parando o servidor antes de
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
- `flashcards` (v4): `course_id` nulo = card geral (CASCADE com o curso); `lesson_id` nulo = do
  curso todo (SET NULL: re-scan que apaga a aula não leva o card). `pendente` = o que falta mandar
  ao Anki. Entram no backup (`flashcards` por curso, `flashcardsGerais`).
- `progress` é uma tabela por aula, com `position_sec`, `furthest_sec` e
  `completed`/`auto_completed`.
- As aulas são apagadas em cascata.
- `courses.poster_lesson_id` aponta para a aula da capa.
- `courses.collection_id` é `ON DELETE SET NULL`: excluir a biblioteca preserva os cursos.

### Web (`web/src`)

React 18 + Vite 6 + TanStack Query 5 + React Router 7 + Tailwind 3.

- `main.tsx`: providers (QueryClient, BrowserRouter).
- `App.tsx`: as rotas `/` (Categorias, o menu principal), `/c/:cat` (Library, aba Cursos),
  `/c/:cat/pdfs` (Pdfs), `/c/:cat/questoes` (Questoes), com `:cat` = id da categoria ou `sem`;
  `CabecalhoCategoria` é o nome e as abas. Além delas, `/course/:id` (Course), `/lesson/:id` (Lesson),
  `/settings` (Settings), `/flashcards` (Flashcards, `?curso=<id>`), `/pdfs` (Pdfs) e `/pdf/:id`
  (LeitorPdf).
- `lib/pdf.ts`: carrega o pdf.js (`pdfjs-dist`, build legacy, por import dinâmico) só quando
  alguém abre um PDF ou falta uma capa, e gera as capas uma de cada vez.
- `api/client.ts`: o único cliente HTTP tipado (`api.*`) e todas as interfaces de DTO, espelhando o
  servidor.
- `api/hooks.ts`: wrappers do TanStack Query. As mutations invalidam `['courses']` e
  `['course', id]`.
- `pages/`:
  - Library: grade de cursos, bibliotecas, adicionar pasta e importação em lote.
  - Course: lista de aulas, retomar e menu ⋯.
  - Lesson: página de assistir estilo YouTube (vídeo à esquerda, abas Aulas/Flashcards à direita),
    salvar progresso, concluir e atalhos de teclado.
  - Settings.
  - Pdfs: estante de PDFs da categoria e Adicionar (arquivos, pasta ou Drive).
  - LeitorPdf: rolagem contínua, cada página desenhada só perto da tela; salva a página onde
    parou; ←/→, +/−, 0 e Esc.
- `components/DirPicker.tsx` conduz o seletor de pastas via `/api/fs/browse`.

## Convenções

- **Sem testes automatizados por enquanto**: a suíte (Vitest) foi removida a pedido, para focar em
  funcionalidade; ela está no histórico do git. O CI só calcula a versão e gera os instaladores.
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
