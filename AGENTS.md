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
categoria com tudo o que estava sem. No menu principal, "Sem categoria" fica oculta (como arquivo
oculto no Finder) e ⌘⇧. / Ctrl+Shift+. mostra ou esconde (`inicio.mostrarSemCategoria`); sem
nenhuma categoria ela aparece sempre. Os downloads ("Baixar") são acompanhados numa seção das
Configurações (`PainelDownloads.tsx`), não num painel flutuante.

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
`identifier` do Tauri, o formato do
backup (`learnflix-library`), o tipo de nota "Learnflix" do Anki e a linha `LEARNFLIX_URL=`. O que o build gera
(o executável `astroflix`, o sidecar `astroflix-server`, `dist/astroflix.cjs`) usa o nome novo:
o atualizador troca o pacote inteiro. A pasta de dados virou `~/.astroflix` (`%LOCALAPPDATA%\Astroflix`): a antiga
(`~/.learnflix`, `%LOCALAPPDATA%\Learnflix`) é movida na primeira abertura e os caminhos dos
downloads no banco são corrigidos (`pasta-de-dados.ts`). Os baralhos `Learnflix::…` são movidos sozinhos para `Astroflix::…`.

O código e os comentários estão em **português**. Os comentários explicam o **porquê** (o caso que
motivou a decisão), não o quê. Siga esse estilo.

**Commits:** não há padrão obrigatório de mensagem de commit (prefixos como `feat:` são
opcionais). O commit vai **direto na `main`** (sem branch nem Pull Request). Cada push nela dispara
uma release (~10 min, em fila), então junte as mudanças num commit só em vez de vários pushes
seguidos.

**Build depois de toda mudança:** ao terminar qualquer mudança de código, rode **`pnpm build`**
(`scripts/build.mjs`, que gera o instalador desta máquina) e diga onde ficou o instalador
(`desktop/src-tauri/target/release/bundle`). É assim que o dono atualiza o app na máquina dele, sem
depender da release do CI, que pode estar parada (em 11/2026 o GitHub Actions travou por cobrança
e cinco releases seguidas falharam sem ninguém notar). Se o build falhar, conserte antes de dar a
tarefa por encerrada. O `pnpm build` dá ao build a versão da última release + 1
(`scripts/versao-local.mjs`, que grava no package.json, tauri.conf.json e Cargo.toml; commite junto):
com a versão do package.json, o atualizador trocava o build pela release antiga ao abrir. Ele também
pula o pacote assinado do atualizador (`tauri.local.conf.json`, a chave privada não fica nesta
máquina) e a arrumação do `.dmg` pelo Finder (`--ci`, que falhava sem permissão de automação), e
ejeta antes o `.dmg` que ficou montado (`scripts/ejetar-dmg.mjs`: com ele aberto, o `bundle_dmg.sh`
falha). **O build local precisa de `.google-oauth.local.json`, `.telegram.local.json` e
`.supabase.local.json` na raiz** (ignorados pelo git): sem eles, o app sai sem conta, sem Telegram e
com todo arquivo do Drive dando 502 `google` (o token não renova). Confira no `server/src/bundled.ts`
que os `*_PADRAO` não estão `null`. O `build.mjs` para antes de começar se faltar um deles ou o `rustc`
(o rustup do Homebrew ele acha sozinho). Não há flag de plataforma: o instalador é sempre o do sistema
em que se está (o Node SEA copia o Node da máquina); os outros saem do CI.

## Comandos

Node >= 22.5 e **pnpm** (gerenciador padrão; `packageManager` no package.json). Monorepo com quatro
workspaces (`pnpm-workspace.yaml`): `server`, `web`, `desktop` e `extension`. Para o app desktop, também o Rust
(rustup; no Homebrew ele é keg-only, então `export PATH="$(brew --prefix rustup)/bin:$PATH"`).

```bash
pnpm install               # primeira vez
pnpm dev                   # janela do Tauri sobre o Vite (:5173, /api → :7777) + Fastify, hot reload
pnpm build                 # instalador desta máquina em desktop/src-tauri/target/release/bundle
pnpm build:servidor        # só web → extension → gerar-bundled → tipos do server → esbuild → dist/astroflix.cjs (o CI usa)
pnpm build:binario         # executável único (Node SEA, ~110 MB) para esta máquina; precisa do build:servidor
pnpm run repo              # audita onde o nome do repositório GitHub aparece (o `pnpm repo` puro é um comando do próprio pnpm)
pnpm run repo dono/repo    # troca o repositório em package.json, README.md e tauri.conf.json
```

**Não há script separado de typecheck nem de lint.** O `tsc --noEmit` roda dentro do `build` de
cada workspace (`pnpm build:servidor` é o jeito rápido de checar os tipos). O servidor nunca emite JS: roda via `tsx` em dev e é empacotado pelo esbuild
(`scripts/empacotar.mjs`) no build. Os imports são ESM **sem extensão de arquivo**
(`moduleResolution: "Bundler"`).

O pacote não é publicado no npm (`"private": true`). As releases saem de
`.github/workflows/release.yml`, disparado por **todo push na `main`** que não seja só de
documentação (lá o build é `build:servidor` e o Tauri fica com o `tauri-action`); a versão é automática (`major.minor` do `package.json` + `GITHUB_RUN_NUMBER`), então
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
- `DATA_DIR`: padrão `~/.astroflix`, ou `%LOCALAPPDATA%\Astroflix` no Windows. Guarda `app.db`,
  `thumbs/`, `converted/`, `downloads/` (pasta de armazenamento padrão dos cursos do Drive e do Telegram)
  e `cache/` (o cache automático das aulas remotas, com limite).
- `ALLOWED_ROOTS`: separado por `:` ou `;`. O padrão é a home do usuário, mais `/Volumes` no macOS,
  `/media` e `/mnt` no Linux, e as unidades detectadas sob demanda no Windows (`roots.ts`).
- `AUTOCOMPLETE_THRESHOLD`: padrão 0.9.

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`: o projeto da conta. Env → `SUPABASE_PADRAO` (de
  `.supabase.local.json`, ignorado pelo git; no CI, dos secrets). A chave é a publishable (pública
  por desenho; quem protege os dados é a RLS de `supabase/schema.sql`). Sem as duas, o app roda sem
  conta.
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: opcionais, só para cursos do Telegram. Mesma
  precedência e mesma regra de segredo das `GOOGLE_*`: env → `TELEGRAM_PADRAO` (o "app próprio" saiu
  das Configurações; o `telegram.credenciais` salvo é apagado ao abrir, encerrando a sessão feita com ele) (de `.telegram.local.json`, ignorado pelo git; no CI, dos secrets).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`: opcionais, só para cursos do Google
  Drive. Precedência, campo a campo: env → `GOOGLE_PADRAO` (não há mais "app próprio" nas Configurações; o que
  estava salvo em `drive.credenciais` é apagado ao abrir), embutido no
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
  (`importacaoDrive`). **Downloads** (`drive/baixar.ts`, Drive e Telegram, uma fila só), dois
  pedidos com destinos diferentes. **Abrir uma aula** (`GET /api/lessons/:id` →
  `baixador.pedirAula`) traz ela e as `JANELA` (2) seguintes não concluídas para o **cache
  automático** (`cache-aulas.ts`, `DATA_DIR/cache/<lessonId>.<ext>`, tabela `cache_aulas` v14, só
  local) e passa na frente (interrompe o arquivo atual, o `.part` fica). O cache tem limite
  (padrão 10 GB, de 2 a 100 GB, Configurações → Armazenamento) e é a **única coisa que o app apaga
  sozinho**: passou do limite, saem as concluídas e depois as usadas há mais tempo; a aula aberta e
  a janela nunca. Aula maior que o limite não entra e toca pela rede. Excluir o curso apaga o cache
  dele; `varrerCache` tira o que ficou sem dono ao abrir. **"Baixar"** (botão direito da aula, menu ⋯
  do curso, do cartão e da categoria) grava na **pasta de armazenamento** (`armazenamento.ts`;
  padrão `DATA_DIR/downloads`, configurável) com o nome real, `<raiz>/<curso>/<rel_path>`,
  registrado na tabela `baixados` (v11, só local, sem nuvem), com o painel de downloads, retomada
  ao abrir o app e novas tentativas; a aula que já está no cache é movida de lá
  (`promoverDoCache`), sem baixar de novo. Retoma `.part` com Range; aula que não toca é convertida
  (`media/preparar.ts`) e o `.mp4` toma o lugar do original (no cache, também). O stream prefere o
  baixado, depois o cache, depois a origem. **O que foi baixado nunca é apagado sozinho**: só
  "Remover download" (curso) ou "Limpar tudo" (Configurações), que não toca o cache. Excluir o curso deixa
  os arquivos; importá-lo de novo (mesmo nome, mesma pasta) os adota em vez de baixar outra vez
  (`adotarArquivosDaPasta`, ao abrir o curso). **Conectar a uma pasta** (menu ⋯ do curso
  remoto, v12 `pastas_baixadas.conectada`): uma pasta da pessoa vira a pasta do curso. O que já está
  lá é adotado pelo caminho, pelo tamanho em bytes ou pelo nome (sem acento, pontuação nem o número
  da mensagem do Telegram), cada arquivo para um item só; o que for baixado depois é acrescentado.
  Nela o app **só acrescenta**: "Remover download", "Limpar tudo" e "Excluir download" não a tocam,
  um arquivo da pessoa com o mesmo nome e outro tamanho faz o download ir para "Nome (2)", e a
  conversão vai para `DATA_DIR/converted` (`protegido`, `saidaDaConversao`). Desconectar só esquece. A
  pessoa pode tirar arquivos da pasta: a aula volta a aparecer cinza (`baixada: false`) e toca pela
  rede. Trocar a raiz começa vazio (a antiga fica intacta). Stream e materiais preferem o arquivo
  baixado; o que não está lá vem da origem. Ao abrir (`buildApp(..., { retomarDownloads })`, só no
  `index.ts`), `migrarCacheAntigo` converte uma vez o cache antigo (nomes por id) para a pasta nova.
- `telegram/`: cursos do Telegram, com a **conta da pessoa** (MTProto, GramJS). Tudo do GramJS
  fica em `gramjs.ts` (importado sob demanda: nada conecta até alguém colar um link); o resto do
  app só conhece `ClienteTelegram` e `ServicosTelegram`, e os testes injetam falsos
  (`buildApp(..., { telegram })`). `link` interpreta `t.me/…`, `mensagens` monta o curso (o
  `rel_path` começa pelo id da mensagem com 10 dígitos, que dá a ordem de postagem e não muda; num grupo com
  tópicos, cada tópico vira um módulo e uma subpasta ao baixar, `<tópico>/<id>-<nome>`, na ordem em que o
  Telegram mostra os tópicos, atualizada a cada re-escaneio; o religamento pelo nome do arquivo
  mantém o progresso de quem tinha o curso sem módulos). O **guia de hashtags** (`guia.ts`;
  `ClienteTelegram.textos` lê só o texto das mensagens fixadas e das 50 mais antigas, onde canais
  costumam pôr o menu de módulos) define o módulo das aulas ainda não mapeadas no scan (`derivar`) e
  vale mais que os tópicos: só conta uma mensagem com 3 ou mais tags que batem com as legendas dos
  vídeos (empate = a mais nova). O título da aula sai sem as hashtags que começam com letra
  (`#D004` é endereço no menu; o `#12` de "Aula #12" fica); legenda só de hashtags usa o nome do arquivo.
  `blocos` alinha o `Range` em blocos de 512 KB, `status` traduz os erros RPC, `stream` repassa
  o vídeo e `baixar` entra na mesma fila de download do Drive (`fonteDoTelegram`; retomar volta ao
  último bloco inteiro). Login por QR com estado em memória (`/api/telegram/login`). `routes/telegram.ts` e
  `scan/scan-telegram.ts` espelham o Drive. O `telegram_peer` do curso guarda o access hash: sem
  ele, um canal privado não é achado depois de reiniciar.
- `links/`: **importar por link** (Adicionar → "De um link", `LinkModal.tsx`). Cola o link de uma página
  (playlist do YouTube, página de um curso), `importar.ts` acha os vídeos e a pessoa revisa a lista
  (desmarca, renomeia) antes de criar. Quem tira o vídeo é o **yt-dlp** (`ytdlp.ts`), opcional como o
  ffmpeg e procurado no PATH. Site que ele conhece (YouTube, Vimeo) responde direto; página genérica
  tem os links lidos (`pagina.ts`: iframes, `<video>`, links do mesmo site e de players conhecidos) e
  cada um é aberto pelo yt-dlp, 4 por vez, na ordem da página (playlists e canais linkados ficam fora).
  A descoberta é um trabalho em memória que a janela consulta (`/api/links/descobrir/:id`). Importar
  cria um **curso local** em `DATA_DIR/links/<curso>` (sem origem nova: player, capas, nuvem e
  progresso são os de sempre) e baixa um vídeo por vez para `.baixando/` (oculto, o scan pula),
  movendo para `NN - <título>.mp4` (o número dá a ordem) e re-escaneando a cada um. O pedido fica em
  `.astroflix-link.json` na pasta: ao abrir, `retomarImportacoes` continua o que faltou. **Curso
  assinado:** "A página pede login" abre o campo **Token de login** (`cabecalhoDeLogin`: só o token vira
  `Authorization: Bearer`, `a=b; c=d` vira `Cookie`, `Nome: valor` vai como está). Ele vai à leitura da
  página e ao yt-dlp (`--add-headers`), mas só para o site do link e os players embutidos nela
  (`mandaLogin`; um YouTube linkado não recebe), e fica no manifesto para os downloads continuarem.
  O yt-dlp chama a página que ele não conhece de `Generic` ou `HTML5MediaEmbed` (`ehGenerico`): aí
  os links dela também são abertos. **Página montada por JavaScript:** com Chrome, Edge, Brave ou
  Chromium instalado (`navegador.ts`, protocolo do DevTools, perfil temporário, sem dependência nova), a
  página abre num navegador invisível que espera o load, a rede quieta e a contagem de links parar de
  mudar (até 30 s); o login vai pedido a pedido (`Fetch.requestPaused`), só para os hosts de
  `mandaLogin`. O vídeo que o player pede pela rede (`.m3u8`, `.mpd`, `.mp4`) é aceito direto, sem
  passar pelo yt-dlp; uma aula do mesmo site em que o yt-dlp não acha nada é aberta no navegador (2 por
  vez, até 80). O item guarda a `pagina` da aula: se o download falha (endereço assinado que venceu), a
  aula é reaberta (`pararNoVideo`) e o endereço novo é baixado. Sem navegador, fica o HTML cru. **Login
  no navegador:** site que guarda a sessão no localStorage/cookies (o do Ferretto: `auth-storage`) não
  aceita só o token e manda para `/login`. O navegador usa o **perfil do Astroflix**
  (`DATA_DIR/navegador`, persistente): "Entrar no site" (`/api/links/entrar`, `abrirJanelaDeLogin`)
  abre o Chrome visível nesse perfil, a pessoa entra uma vez, e a leitura invisível herda a sessão.
  Dois Chromes não abrem o mesmo perfil: há um invisível compartilhado (`obterNavegador`/`soltar`,
  fecha após 20 s ocioso), e a leitura fecha a janela de login (SIGTERM, que grava o localStorage)
  antes de começar. Terminou em `/login`: erro `precisa-entrar`, sem abrir os links da tela de login. **Logs:** cada leitura registra o passo a passo (status HTTP, tipo e
  tamanho da página, quantos `<a>`/`<script>`, o que o yt-dlp disse de cada link; o token só mascarado)
  em `Descoberta.log` (a janela mostra em "Detalhes") e em `DATA_DIR/logs/links/<data> <host>/`,
  com `leitura.log` e o HTML recebido (`pagina.html`, ou `resposta.txt` num erro), ficando as 30 mais
  novas. Os downloads de cada curso vão para `.astroflix-link.log` na pasta dele ("Ver log" no aviso de
  erro do curso).
- **Extensão do navegador** (`extension/`, Chrome MV3, workspace com Vite + CRXJS; popup em React em
  `src/popup/`, `src/background.js` em JS puro, sem minificar): a pessoa abre a aula no
  próprio Chrome, já logada, e manda o vídeo para uma **playlist** (um curso de link vazio, criado em
  Adicionar → "Playlist (pela extensão)" ou pelo + da extensão). `background.js` observa os pedidos de
  vídeo de cada aba (`webRequest.onSendHeaders` com `extraHeaders`: `.m3u8`/`.mpd`/`.mp4`, sem os
  segmentos) e guarda o endereço e os cabeçalhos úteis (Cookie, Authorization, Referer, Origin,
  User-Agent); o popup escolhe a playlist, o título (o h1 da página) e o vídeo, e manda para
  `POST /api/extensao/playlists/:id/itens`. O item leva os `cabecalhos` para o yt-dlp. O `extension/dist` (o
  `build:servidor` compila a extensão antes) entra no build (`EXTENSAO` em `bundled.ts`, por
  `gerar-bundled.mjs`, só texto) e Configurações → Extensão do navegador a grava em `DATA_DIR/extensao`
  (o nome antigo fica: o Chrome guarda o caminho de quem já carregou) e abre `chrome://extensions` ("Carregar sem compactação"). **Segurança:**
  a guarda deixa passar `chrome-extension://` só em `/api/extensao/*` (`ehExtensao`), e essas rotas
  exigem `X-Astroflix-Chave` (`routes/extensao.ts`, gerada em `settings` e mostrada nas Configurações).
  A extensão procura o app de 7777 a 7797. O download relê o manifesto a cada vídeo e grava só o item
  que mudou: aula acrescentada no meio do download entra na fila; a mesma aula duas vezes só atualiza
  o endereço. **Sub-playlist** (uma playlist dentro da outra): uma subpasta `NN - Nome` (o número dá a ordem
  de criação), listada em `manifesto.modulos`, que o scan mostra como módulo; o item leva `modulo` e
  é numerado dentro dela. Criada pelo "+ Nova sub-playlist" da página do curso ou pela extensão
  ("Dentro da escolhida"), ou já ao criar (Adicionar → Playlist, campo "Dentro de"). **Mover para dentro de
  outra playlist** (menu ⋯, `moverPlaylistParaDentro`, `POST /api/links/playlists/:id/mover`): a playlist vira
  a subpasta `NN - <nome>` da outra (as sub-playlists dela, módulos irmãos `NN - <nome> - <sub>`, porque o scan
  só conhece um nível), os itens entram no manifesto do destino, o progresso, o título renomeado e os
  flashcards vão para as aulas novas (achadas pelo caminho novo) e a playlist de origem é excluída
  (fica `playlist.movida.<id>` em `settings`: `destinoDaPlaylist` leva o que a extensão ainda mandar
  para o id antigo ao módulo novo, e o popup troca a escolha guardada). **A playlist é reconhecida
  pelo manifesto na pasta** (`ehPlaylist`), não por morar em `DATA_DIR/links`: re-apontada (por
  exemplo para a cópia na pasta de downloads), `levarManifesto` leva o manifesto e o log para a pasta
  nova, o "Baixar" continua e os vídeos novos já chegam lá. **Arrastar e
  soltar** (HTML5, `dragDropEnabled: false` no `tauri.conf.json`, senão o Windows engole o arraste): uma
  playlist sobre outra no menu da categoria faz o mesmo mover; uma aula da playlist sobre uma sub-playlist
  (o chip ou o cabeçalho do módulo) ou em "Fora das sub-playlists" muda a aula de subpasta
  (`moverAulaParaSubPlaylist`, `POST /api/links/aulas/:id/mover`), indo para o fim dela com o progresso. **"Baixar para downloads"** (menu ⋯ da playlist e o "Baixar" da categoria,
  `exportarPlaylist`): os vídeos vão para a pasta de armazenamento (`pastaDoCurso`), com as subpastas
  das sub-playlists, por hard link (mesmo disco, sem ocupar o dobro) ou cópia; `manifesto.exportar`
  faz cada vídeo que chegar depois ir também. Não entram em `baixados`: o app nunca apaga essa cópia. O título da aula na extensão vem de `span.font-family-headlines` (Ferretto),
  depois h1/h2, depois o da aba. **Importar a página toda** (popup → "Importar a página toda", roda no `background.js`
  porque o popup fecha ao perder o foco): para cada elemento do seletor (padrão
  `p.text-sm.font-family-body.text-body.font-semibold`, o nome da aula no Ferretto; editável e
  lembrado), clica no item clicável em volta, espera até 25 s o player pedir um vídeo novo (a
  extensão regrava a hora de um vídeo pedido de novo) e manda com o texto como título; o progresso fica
  em `storage.session.lote`. Num site em JavaScript todas as aulas têm o mesmo endereço: a mesma aula
  no manifesto é o mesmo vídeo ou a mesma página **e** o mesmo título, e o download só reabre a página
  para renovar um endereço vencido se ela for só daquela aula (senão viria o vídeo de outra). O modo
  padrão, porém, é **seguir o botão "Próxima"** (`importarSeguindo`): no Ferretto o clique na lista
  não abre outra aula. Manda a aula aberta (título por `span.font-family-headlines`/h1/h2 e o último
  vídeo pedido), clica no botão visível e habilitado cujo texto começa com o configurado (sem acento
  nem maiúscula), espera o vídeo novo (20 s) e repete. Aula sem vídeo (texto, exercício, player
  protegido) é **pulada** e listada; para sem o botão, se nem o vídeo nem o título trocarem depois do
  clique, quando abre o popup do **Simulado** (um `span.text-headings.font-family-headlines.text-lg.font-semibold` visível com "Simulado", conferido antes de mandar cada aula e 1,5 s depois de cada clique), depois de 15 puladas seguidas ou em 500. A página tem mais de um "Próxima" (o de dentro da
  aula troca a questão), então `clicarNoBotao` escolhe: com o título de aula de vídeo do Ferretto (o
  `<span class="font-family-headlines text-headings text-xl sm:text-2xl font-semibold leading-8">`),
  o "Próxima" logo **abaixo do `<video>`** (ou do título, se o vídeo está num iframe); sem esse título,
  ou com o `span` "Gabarito" (`font-normal font-family-body text-headings text-lg sm:text-md`) na tela mesmo
  com ele (o **Gabarito de questões**), o botão com as classes `text-sm font-family-body`, no próprio botão, no
  texto dentro dele ou num elemento clicável qualquer (havendo dois, o segundo na ordem da página). A aula trocou se o título ou o endereço da aba mudou; se não trocou, tenta o botão
  seguinte dessa ordem antes de desistir.
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
- `media/`: `ffmpeg.ts` detecta ffmpeg/ffprobe e `thumbs.ts` gera as capas. As rotas de capa só
  respondem com o que está no disco (`capaNoDisco`) e, se falta, pedem à `fila-capas.ts` e devolvem
  404 na hora (esperar a rede prendia as conexões da janela). A fila é LIFO (o que está na tela
  primeiro), até 500 pedidos, e gera nesta ordem: ffmpeg sobre o arquivo local (aula local, baixada
  ou no cache), miniatura da origem (Drive, Telegram) e ffmpeg lendo um quadro do próprio stream
  (`http://127.0.0.1:<porta>`, 30 s de limite, uma por vez, pausado enquanto há vídeo remoto
  tocando). A falha fica em `capas_estado` (v14, só local): `rede` tenta de novo em 5 min,
  `sem-capa` em 1 h, 6 h, 24 h e depois a cada 7 dias, `sem-ffmpeg` quando o app abrir com ffmpeg.
  Na interface, `CapaAula.tsx` tenta de novo em 5, 15 e 45 s. `varrerCapas` tira as órfãs de
  `thumbs/` ao abrir.
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

- `src-tauri/src/lib.rs`: instância única, sobe o sidecar `astroflix-server`, lê o stdout até
  `LEARNFLIX_URL=` e navega a janela; em 20 s sem a linha, ou se o servidor morrer, mostra a tela de
  erro (`carregando/index.html?erro=`) com "Tentar de novo" (comando `reiniciar`). Mata o sidecar ao
  sair. Cada subida tem uma geração: eventos de um processo antigo não mexem mais na janela.
- Segundo plano: enquanto há "Baixar" em andamento, o servidor escreve
  `LEARNFLIX_BAIXANDO=1` (e `=0` no fim). O `lib.rs` segura o sistema acordado (no macOS uma
  atividade `UserInitiated`, que também tira o App Nap; no Windows `SetThreadExecutionState`) e
  fechar a janela só a esconde (no macOS; nos outros, minimiza). O Dock a traz de volta; acabou o
  download com a janela fechada, o app sai.
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
- `lessons.titulo_editado` (v15): o "Renomear" do botão direito da aula (`PATCH /api/lessons/:id`).
  Muda só o título, nunca o arquivo (o `rel_path` é a identidade na nuvem e no progresso); o
  re-escaneio e a descida da nuvem fazem `COALESCE(titulo_editado, …)`. Vazio volta ao nome do arquivo.
- **Árvore dos módulos e mapeamento** (v16/v17, `routes/mapa.ts`, `MapearCurso.tsx`): curso local e do
  Drive **não têm mapeamento**: a página monta a árvore das pastas a partir do `rel_path`, em qualquer
  profundidade (`arvore.ts`; só a pasta que embrulha tudo sai, um nível), porque o mapeamento antigo
  desfigurava quem já tinha uma organização boa em pastas. A v17 desfez os mapeados desses cursos
  (recalculou módulo e ordem pelo `deriveCourse`, tirou as pastas dos títulos não editados) e, no boot,
  reorganiza os baixados do Drive para o caminho de origem (`settings` `mapa.reorganizar`, `index.ts`); o download interrompido também vai, porque a v17 guarda antes onde estava o `.part` (`parciaisAntes` → `mapa.parciais`).
  **Só o Telegram mapeia**, e só no import do curso novo (não o lote nem a playlist): `courses.mapa_pendente`
  faz a página abrir, quando a leitura termina, a tela em que a pessoa cria módulos e **submódulos**
  ("+ Submódulo"), arrasta as aulas (ou marca várias, com Shift, e move), renomeia e liga um arquivo de texto
  como descrição (`lessons.descricao_rel`; `''` = nenhuma, nem a adivinhada pelo nome). As rotas `/mapa` e
  `/mapa/aulas` respondem 400 `so-telegram` nos outros. O menu ⋯ ("Organizar módulos e aulas…", `?mapear=1`)
  reabre. **"Organizar por texto…"** (menu ⋯, `?mapear=texto`, `ModelarPorTexto.tsx`): a pessoa cola o índice do
  curso ou escreve como quer os módulos, e `POST /api/courses/:id/mapa/texto` pergunta ao **Claude Code** dela
  (`claude.ts`: `claude -p` com saída estruturada, `--model opus`, numa pasta vazia, sem ferramentas, MCP,
  configurações nem plugins, que levavam ~100 mil tokens a cada pedido; o binário é procurado também em
  `~/.local/bin` e `~/.claude/local`, fora do PATH do app aberto pelo Dock). As aulas vão numeradas (1..N), não pelos
  ids; a resposta não é gravada: abre na tela de mapeamento já montada, para conferir e salvar. Sem o Claude Code,
  424 `sem-claude` e a janela explica como instalar. O `module` é o **caminho** `"A/B"` (até 5 níveis). `lessons.mapeada` = módulo, ordem e título são da
  pessoa: o re-escaneio não os recalcula, e a aula que chega depois (`mapeada=0`, ordem 50000+) abre o popup
  `AulasNovas.tsx` para escolher o módulo (vai para o fim dele). **A pasta de origem nunca muda**: só o
  "Baixar" vira pastas, uma por nível: `NN - A/NN - B/NN - Título.ext` (`pastasDoModulo` e `partesNoCurso`
  em `armazenamento.ts`), com a descrição ao lado e o mesmo nome. Mudar o mapeamento move o que já foi
  baixado (`reorganizarBaixados`, em duas passadas, com os downloads do curso pausados), inclusive o `.part` do que parou no meio: o caminho antigo é tirado com `parciaisAntes` antes de gravar o mapeamento novo. Sobe para a
  conta em `aulas.mapeada`/`aulas.descricao_rel` (rodar o `schema.sql` de novo); sem as colunas, a
  aula sobe sem elas e o mapeamento fica só nesta máquina.
- `cache_aulas` e `capas_estado` (v14) são só desta máquina, sem gatilho da nuvem: o cache
  automático das aulas remotas e o estado das capas que falharam.
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
- `components/VisualizadorArquivo.tsx`: os arquivos do curso que não são vídeo abrem no app, por
  cima da página: PDF pelo pdf.js, texto e código, Markdown (`marked`), notebook do Jupyter, Word
  `.docx` (`mammoth`) e planilhas/CSV (SheetJS, do tarball do cdn.sheetjs.com: o do npm parou na
  0.18). Tudo por import dinâmico e o HTML gerado passa pelo DOMPurify. O resto (zip, pptx, doc
  antigo) é baixado.
  **Arquivos ligados à aula** (`ligacoesDasAulas` em `lib/arvore.ts`): um documento (txt, md, pdf, doc,
  docx) é da aula se tem o mesmo nome do vídeo (pode ter um "Descrição" a mais) ou o mesmo "Aula N".
  Procura-se na pasta do vídeo, nela sem o segmento de materiais (`/^(materia(l|is)|apoio|anexos?)\b/i`,
  sem o número inicial), 1 a 2 níveis acima e, se o nome for único, no curso todo. Como descrição vale
  txt/md, depois docx, depois pdf (aparece embaixo dos botões do player, `DescricaoDaAula.tsx`); os
  demais ligados são anexos logo abaixo da aula. Quem foi ligado sai da lista de arquivos. Ordem numa
  pasta: pastas com aula e aulas juntas, na ordem do servidor (a do "Próxima" no player), depois os
  arquivos soltos e por fim as pastas só de arquivos (esses dois em ordem natural do nome).
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
- Pastas e arquivos do disco são escolhidos pelo seletor nativo do sistema (`escolherPasta` e
  `escolherPdfs` em `lib/desktop.ts`, plugin dialog do Tauri), inclusive "Conectar a uma pasta".

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
