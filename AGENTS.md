# AGENTS.md

Orientações para agentes de código (Claude Code, Codex e afins) trabalharem neste repositório.

## O que é

**Learnflix** é um app local para assistir cursos em vídeo guardados em pastas do disco, com
progresso confiável. Cada pasta escolhida vira um "curso"; o app escaneia, lista as aulas (com
módulos, materiais, duração e capas), transmite o vídeo por HTTP Range e guarda posição e conclusão
no SQLite. Cursos podem ser agrupados em **bibliotecas** (coleções).

O projeto roda **com um comando só** (`npx learnflix`): o único pré-requisito é o Node 22. Assistir
cursos locais funciona sem conta, sem rede e sem serviço externo. Recursos que usam rede (por
exemplo, baixar uma pasta do Google Drive) são **opcionais**: quem não usa nunca precisa configurar
nada para eles, e nenhuma mudança pode transformá-los em pré-requisito do resto do app.

O código e o histórico de commits estão em **português** (prefixos `feat:`/`fix:`/`test:`/
`refactor:`/`chore:`/`docs:`). Escreva comentários e commits no mesmo idioma. Os comentários
explicam o **porquê** (o caso que motivou a decisão), não o quê. Siga esse estilo.

## Comandos

Node >= 22.5, npm. Monorepo com dois workspaces: `server` e `web`.

```bash
npm install                # primeira vez
npm run dev                # Vite (:5173, faz proxy de /api → :7777) + Fastify (:7777), hot reload
npm run build              # web → gerar-bundled → tipos do server → esbuild → dist/learnflix.cjs
npm start                  # roda dist/learnflix.cjs (precisa do build antes)
npm test                   # testes dos dois workspaces
npm run build:binario      # executável único (Node SEA, ~110 MB) para esta máquina; precisa do build
npm run repo               # audita onde o nome do repositório GitHub aparece
npm run repo -- dono/repo  # troca o repositório em package.json, install.sh, install.ps1 e README.md
```

Um teste só:

```bash
npm run test --workspace=server -- src/scan/derive.test.ts
```

**Não há script separado de typecheck nem de lint.** O `tsc --noEmit` roda dentro do `build` de
cada workspace. O servidor nunca emite JS: roda via `tsx` em dev e é empacotado pelo esbuild
(`scripts/empacotar.mjs`) no build. Os imports são ESM **sem extensão de arquivo**
(`moduleResolution: "Bundler"`).

O pacote publicado contém só `dist/learnflix.cjs` (campo `files`). Os documentos do repositório
nunca chegam a quem instala. As releases (binários + instaladores `install.sh`/`install.ps1`) saem
de `.github/workflows/release.yml`.

## Variáveis de ambiente

Lidas em `server/src/config.ts`:

- `PORT`: padrão 7777. Se estiver ocupada, o app anda para a próxima (ver `listen.ts`).
- `BIND`: padrão 127.0.0.1.
- `DATA_DIR`: padrão `~/.learnflix`, ou `%LOCALAPPDATA%\Learnflix` no Windows. Guarda `app.db`,
  `thumbs/` e `converted/`.
- `ALLOWED_ROOTS`: separado por `:` ou `;`. O padrão é a home do usuário, mais `/Volumes` no macOS,
  `/media` e `/mnt` no Linux, e as unidades detectadas sob demanda no Windows (`roots.ts`).
- `AUTOCOMPLETE_THRESHOLD`: padrão 0.9.
- `OPEN_BROWSER`.

## Arquitetura

**A divisão cliente/servidor existe porque o navegador não lê caminhos arbitrários do disco.** O
servidor Fastify lê as pastas (sempre só-leitura), transmite o vídeo, gera as miniaturas e é dono do
SQLite. A SPA React conversa com ele por uma API JSON.

### Servidor (`server/src`)

- `index.ts`: bootstrap, nesta ordem: `quiet` (tem de ser o **primeiro import**), config, herança
  do v1, diretórios, `openDb`, `buildApp`, `escutarComFallback`, banner, navegador.
- `app.ts`: `buildApp(config, db)` monta o Fastify. Primeiro registra a guarda, depois os plugins
  de rota. **Rota nova entra aqui, no marcador `// [ROUTES]`.**
- `guarda.ts`: a fronteira contra páginas da internet abertas no navegador da pessoa. Recusa `Host`
  que não seja localhost ou um IP literal (contra DNS rebinding) e `Origin` de fora desta máquina em
  requisições que mudam estado (contra CSRF). Toda rota nova herda essa proteção. Não contorne.
- `spa.ts`: serve a interface a partir de `bundled.ts` (base64 embutido no build), com fallback para
  a casca em URLs que não começam com `/api`. **Nada é lido do disco.** No v1 a SPA era procurada
  relativa ao `cwd` e sumia se o processo subisse de outro lugar.
- `bundled.ts`: **gerado** por `scripts/gerar-bundled.mjs` (interface + versão). Não versionado,
  não editar à mão. `pretest`, `predev` e `build` o regeneram.
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
- `media/`: `ffmpeg.ts` detecta ffmpeg/ffprobe e `thumbs.ts` gera as capas.
- `listen.ts`, `banner.ts`, `abrir-navegador.ts`: porta ocupada, mensagem de boot e abrir o
  navegador sem depender de pacote externo (o `open` não sobrevive ao empacotamento).
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

### Modelo de dados (SQLite)

O schema fica em `server/src/db/schema.ts` e os tipos de linha em `server/src/types.ts`.

**Princípio central: o progresso nunca se prende a um caminho absoluto.** O curso tem um `id`
interno estável e a aula é identificada pelo `rel_path` dentro do curso. Mover a pasta de origem e
re-apontar preserva o histórico.

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
