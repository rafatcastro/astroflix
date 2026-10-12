# Curso a partir do Google Drive — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox
> (`- [ ]`) para acompanhamento.

**Objetivo:** colar o link de uma pasta do Google Drive e ela virar um curso na estante, com o vídeo
repassado sob demanda pelo servidor local para o player do Learnflix.

**Arquitetura:** um módulo novo `server/src/drive/` (link, cliente da API, OAuth, listagem e repasse
de stream) alimenta o `deriveCourse` e o `planReconcile` que já existem. Cada ponto que hoje abre
`root_path` no disco passa a olhar `courses.source`. A interface ganha um campo de link com o popup do
Google, mensagens de erro no player e uma seção nas Configurações.

**Stack:** Node 22 (`fetch` nativo, `node:crypto`), Fastify 5, `node:sqlite`, Vitest, React 18 +
TanStack Query 5 + Tailwind 3. **Nenhuma dependência nova.**

**Spec:** `docs/specs/2026-10-12-curso-google-drive-design.md`

## Pré-requisito antes da Tarefa 1

A árvore de trabalho tem mudanças do dono do repositório que ainda não estão em commit (`guarda.ts`,
`routes/stream.ts`, `routes/materials.ts`, `media/thumbs.ts`, `backup/*`, `Settings.tsx`…). Este plano
foi escrito **em cima delas**. Elas precisam estar em commit antes de começar, feito por quem as
escreveu, e `npm test` precisa passar no ponto de partida.

## Restrições globais

- Comentários, mensagens de commit e textos da interface em **português**; commits com os prefixos
  `feat:`/`fix:`/`test:`/`refactor:`/`chore:`/`docs:`.
- Imports ESM **sem extensão** de arquivo.
- Nenhum teste toca a rede: toda chamada ao Google passa por um `fetch` injetado.
- Cursos locais não mudam de comportamento. A suíte que já existe continua passando sem alteração de
  asserções.
- Escopos OAuth exatos: `https://www.googleapis.com/auth/drive.readonly`, `openid`, `email`.
- Redirecionamento: `http://<host da requisição>/api/drive/auth/callback`, com PKCE `S256`. O `state`
  vale por 10 minutos e é de uso único.
- Chaves de `settings`: `drive.refresh_token`, `drive.email`, `drive.credenciais` (JSON
  `{clientId, clientSecret, apiKey}` com campos opcionais).
- Retry: até 6 tentativas em 429, 5xx e 403 com motivo `rateLimitExceeded`/`userRateLimitExceeded`,
  esperando `2^n + 1` segundos.
- Tipos de erro que a interface explica: `sem-acesso`, `cota-esgotada`, `sem-conexao`,
  `nao-autorizado`, `nao-e-pasta`, `link-invalido`.
- **Desvio consciente da spec:** as credenciais padrão **não** entram em commit no `config.ts`. O
  GitHub bloqueia push com client secret do Google e chave `AIza…` (push protection), e o repositório
  é público. Elas são embutidas no build: o `scripts/gerar-bundled.mjs`, que já gera o
  `server/src/bundled.ts` (fora do git) no `predev`, no `pretest` e no `build`, passa a escrever
  `GOOGLE_PADRAO`. Os valores vêm das variáveis `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
  `GOOGLE_API_KEY` ou de `.google-oauth.local.json`, que está no `.gitignore`. Na CI, vêm de secrets
  do GitHub. O pacote publicado continua levando os valores embutidos, como a spec pede.

## Pontos de revisão

As cinco situações que a spec implica sem que nenhum teste da spec as cubra, cada uma com o teste
que a fixa na tarefa dona do código:

1. **Dois arquivos com o mesmo nome na mesma pasta do Drive** (o Drive permite). Sem tratamento, o
   `UNIQUE(course_id, rel_path)` derruba a ingestão. O esperado é que o segundo vire `aula (2).mp4`,
   em ordem de `createdTime` e, empatando, de `id`. Teste na Tarefa 5.
2. **Nome com `/` ou `\`** (válido no Drive). Sem tratamento, quebraria os segmentos de módulo. O
   esperado é a troca por `-`, como o `sanitize_name` do script de origem. Teste na Tarefa 5.
3. **Atalho que aponta para uma pasta ancestral.** Sem tratamento, gera recursão infinita. O esperado
   é visitar cada pasta uma vez só. Teste na Tarefa 5.
4. **Colar o mesmo link duas vezes.** O esperado é re-escanear o curso existente e devolver o mesmo
   `id` com `existente: true`, nunca duplicar. Teste na Tarefa 9.
5. **Access token expirando no meio da aula.** O esperado é que um 401 do Drive renove o token uma
   vez e repita a requisição, sem o player ver erro. Teste na Tarefa 3.

---

### Tarefa 1: Migração v2, tipos e credenciais

**Arquivos:**
- Modificar: `server/src/db/index.ts` (`migrate`), `server/src/types.ts` (`CourseRow`, `LessonRow`,
  `MaterialRow`), `scripts/gerar-bundled.mjs`, `server/src/config.ts`
- Criar: `server/src/drive/tipos.ts`, `server/src/drive/credenciais.ts`
- Teste: `server/src/db/index.test.ts`, `server/src/drive/credenciais.test.ts`

**Interfaces:**
- Produz `drive/tipos.ts`:
  ```ts
  export type Fetch = typeof fetch;
  export type TipoFalha = 'sem-acesso' | 'cota-esgotada' | 'sem-conexao' | 'nao-autorizado' | 'nao-e-pasta' | 'link-invalido' | 'google';
  export class FalhaDrive extends Error { constructor(readonly tipo: TipoFalha, readonly status?: number) }
  export interface CredenciaisGoogle { clientId: string | null; clientSecret: string | null; apiKey: string | null }
  export interface LinkDrive { folderId: string; resourceKey: string | null }
  ```
- Produz `credenciaisGoogle(db: Db, env?: NodeJS.ProcessEnv, padrao?: CredenciaisGoogle): CredenciaisGoogle`.
  A precedência é campo a campo: `settings['drive.credenciais']`, depois env, depois `GOOGLE_PADRAO`
  do `bundled.ts`. Também produz `salvarCredenciais(db, parcial: Partial<CredenciaisGoogle>): void`;
  string vazia apaga o campo.
- Produz as colunas `courses.source` (`'local'|'drive'`, padrão `'local'`), `courses.drive_folder_id`,
  `courses.drive_resource_key`, `lessons.remote_id` e `materials.remote_id`, com o SQL exato que está
  na spec.

- [ ] **Passo 1: teste da migração.** Em `db/index.test.ts`, o caso `'v1 → v2 preserva dados e marca
  cursos como local'`:
  - cria um banco só com `SCHEMA_V1` e `user_version = 1`, mais um curso e uma aula;
  - chama `migrate(db)`;
  - espera `pragma(db,'user_version') === 2`;
  - espera que o curso tenha `source === 'local'` e `drive_folder_id === null`;
  - espera que a aula tenha `remote_id === null`.

  Outro caso: `'migrate é idempotente em v2'`, que roda duas vezes sem erro.
- [ ] **Passo 2:** `npm run test --workspace=server -- src/db/index.test.ts`. Esperado: FALHA, com
  `user_version` igual a 1.
- [ ] **Passo 3:** acrescentar o bloco `if (version < 2)` em `migrate`, com os cinco `ALTER TABLE` da
  spec e `pragma(db, 'user_version = 2')`. Acrescentar os campos opcionais em `types.ts`.
- [ ] **Passo 4: testes das credenciais.** Em `drive/credenciais.test.ts`:
  - `'settings vence env, env vence padrão, campo a campo'`: com settings `{clientId:'S'}`, env
    `GOOGLE_API_KEY=E` e padrão `{clientId:'P', clientSecret:'P', apiKey:'P'}`, espera
    `{clientId:'S', clientSecret:'P', apiKey:'E'}`;
  - `'salvarCredenciais com string vazia remove o campo'`;
  - `'sem nada configurado → tudo null'`.
- [ ] **Passo 5:** implementar `credenciais.ts`.
  - No `gerar-bundled.mjs`, escrever `export const GOOGLE_PADRAO = {clientId, clientSecret, apiKey}`.
    Os valores vêm das envs `GOOGLE_*` ou, na falta delas, de `.google-oauth.local.json` na raiz.
    Sem nenhuma das duas fontes, todos ficam `null`.
  - Num comentário, explicar por que as credenciais não vão para o git.
- [ ] **Passo 6:** `npm test`. Esperado: tudo passa.
- [ ] **Passo 7:** commit `feat: migração v2 e credenciais do Google para cursos do Drive`.

### Tarefa 2: Link do Drive

**Arquivos:**
- Criar: `server/src/drive/link.ts`
- Teste: `server/src/drive/link.test.ts`

**Interfaces:**
- Produz `parseLinkDrive(texto: string): LinkDrive | null`.

- [ ] **Passo 1: testes.** Com o id `1agQg1fIAst2WYhAXtYyTf1wDhGBR73D_`, cada formato abaixo deve devolver
  `{ folderId: id, resourceKey: null }`:
  - `https://drive.google.com/drive/folders/<id>`
  - `.../drive/folders/<id>?usp=sharing`
  - `.../drive/u/1/folders/<id>`
  - `https://drive.google.com/open?id=<id>`
  - o id puro, com espaços em volta

  Os outros casos:
  - `...folders/<id>?resourcekey=0-abc` → `resourceKey: '0-abc'`;
  - `https://drive.google.com/file/d/<id>/view` → `null`, porque é arquivo e não pasta;
  - `https://docs.google.com/document/d/<id>` → `null`;
  - `https://exemplo.com/folders/<id>` → `null`;
  - `''` → `null`.
- [ ] **Passo 2:** rodar o teste. Esperado: FALHA, porque o módulo ainda não existe.
- [ ] **Passo 3:** implementar com `new URL`. O host precisa ser exatamente `drive.google.com`, e o
  id precisa casar com `^[\w-]{10,}$`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: reconhecer links de pasta do Google Drive`.

### Tarefa 3: Cliente da Drive API

**Arquivos:**
- Criar: `server/src/drive/api.ts`
- Teste: `server/src/drive/api.test.ts`

**Interfaces:**
- Consome: `Fetch`, `FalhaDrive` (Tarefa 1).
- Produz:
  ```ts
  export interface ArquivoDrive {
    id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; createdTime?: string;
    thumbnailLink?: string; videoMediaMetadata?: { durationMillis?: string };
    shortcutDetails?: { targetId: string; targetMimeType: string }; resourceKey?: string;
  }
  export interface DepsCliente {
    fetch: Fetch; apiKey: string | null;
    token: (opts?: { renovar?: boolean }) => Promise<string | null>;
    esperar?: (ms: number) => Promise<void>;          // padrão: setTimeout; testes passam () => Promise.resolve()
    resourceKeys?: string | null;                      // valor de X-Goog-Drive-Resource-Keys: "<id>/<chave>"
  }
  export interface ClienteDrive {
    getArquivo(id: string): Promise<ArquivoDrive>;
    listarFilhos(pastaId: string): Promise<ArquivoDrive[]>;      // pagina até acabar
    baixar(id: string, range: string | undefined, signal?: AbortSignal): Promise<Response>;
  }
  export function criarClienteDrive(deps: DepsCliente): ClienteDrive;
  export const CAMPOS_ARQUIVO = 'id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,videoMediaMetadata,shortcutDetails,resourceKey';
  ```
- Regras:
  - Base `https://www.googleapis.com/drive/v3/files`, sempre com `supportsAllDrives=true`.
  - A listagem usa `includeItemsFromAllDrives=true`, `pageSize=1000`,
    `q='<id>' in parents and trashed=false` e `fields=nextPageToken,files(CAMPOS_ARQUIVO)`.
  - Se `token()` devolver um token, a requisição vai com `Authorization: Bearer`; senão, com
    `key=<apiKey>`.
  - O `baixar` usa `alt=media`, repassa o `Range` e **não** repete depois que o corpo começou a vir.

- [ ] **Passo 1: testes**, com um `fetch` falso que registra as chamadas e devolve respostas
  enfileiradas:
  - `'usa key= sem token e Bearer com token'`.
  - `'listarFilhos segue nextPageToken'`: duas páginas, junta 3 arquivos.
  - `'429 e 503 repetem com espera 2^n+1 s e depois funcionam'`: espera as esperas `[2000, 3000]`.
  - `'desiste depois de 6 tentativas → FalhaDrive google'`.
  - `'404 → sem-acesso'` e `'403 insufficientFilePermissions → sem-acesso'`.
  - `'403 downloadQuotaExceeded → cota-esgotada, sem repetir'`.
  - `'TypeError do fetch, repetido até o fim → sem-conexao'`.
  - **Ponto de revisão 5:** `'401 renova o token uma vez e repete'`. O primeiro `fetch` dá 401 e o
    segundo dá 206. Espera `token` chamado com `{renovar:true}` e a resposta 206 entregue.
  - `'401 depois da renovação → nao-autorizado'`.
  - `'baixar repassa Range e o cabeçalho de resource key'`.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
  - Para classificar o erro, ler `error.errors[0].reason` do corpo JSON.
  - O retry envolve só a obtenção da `Response`.
- [ ] **Passo 4:** rodar. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: cliente mínimo da Drive API com retry e erros nomeados`.

### Tarefa 4: OAuth para app de computador

**Arquivos:**
- Criar: `server/src/drive/auth.ts`
- Teste: `server/src/drive/auth.test.ts`

**Interfaces:**
- Consome: `credenciaisGoogle` (Tarefa 1), `Fetch`.
- Produz:
  ```ts
  export const ESCOPOS: string[];   // os três da Restrição global, nessa ordem
  export interface AuthDrive {
    iniciar(redirectUri: string): string;
    concluir(p: { code?: string; state?: string; error?: string }):
      Promise<{ ok: true; email: string | null } | { ok: false; motivo: 'state-invalido' | 'negado' | 'troca-falhou' | 'sem-credenciais' }>;
    token(opts?: { renovar?: boolean }): Promise<string | null>;
    status(): { conectado: boolean; email: string | null };
    desconectar(): Promise<void>;
  }
  export function criarAuthDrive(deps: { db: Db; fetch: Fetch; credenciais: () => CredenciaisGoogle; agora?: () => number }): AuthDrive;
  ```
- Regras:
  - `iniciar` monta `https://accounts.google.com/o/oauth2/v2/auth` com `client_id`, `redirect_uri`,
    `response_type=code`, `scope` (escopos separados por espaço), `code_challenge` (S256 do verifier
    de 32 bytes aleatórios em base64url), `code_challenge_method=S256`, `state` (16 bytes aleatórios
    em base64url), `access_type=offline` e `prompt=consent`. O `{verifier, redirectUri, expira}` fica
    num `Map` em memória.
  - `concluir` faz `POST https://oauth2.googleapis.com/token` (form) com
    `grant_type=authorization_code`, o `code`, o `code_verifier`, o `client_id`, o `client_secret` e o
    `redirect_uri`. Grava `drive.refresh_token` e `drive.email`; o email vem do payload decodificado
    do `id_token`.
  - `token()` sem refresh token devolve `null`. Com ele, devolve o access token em cache até 60 s
    antes de expirar, ou renova com `grant_type=refresh_token`. `{renovar:true}` ignora o cache. Se a
    renovação der `invalid_grant`, o refresh token é apagado e `token()` lança `FalhaDrive('nao-autorizado')`.
  - `desconectar` chama `POST https://oauth2.googleapis.com/revoke?token=<refresh>` como melhor
    esforço (erro ignorado) e apaga as duas chaves de `settings`.

- [ ] **Passo 1: testes:**
  - `'iniciar gera URL com PKCE S256, state e os três escopos'`;
  - `'concluir recusa state desconhecido'`;
  - `'concluir recusa state reusado'`: o segundo uso dá `state-invalido`;
  - `'concluir recusa state vencido'`: com `agora` avançado 10 min + 1 ms;
  - `'error=access_denied → negado'`;
  - `'concluir grava refresh token e email do id_token'`;
  - `'token usa cache e renova perto de expirar'`;
  - `'invalid_grant na renovação desconecta e lança nao-autorizado'`;
  - `'desconectar apaga settings mesmo se revoke falhar'`;
  - `'sem clientId → iniciar lança FalhaDrive nao-autorizado'`.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar com `node:crypto` (`randomBytes`, `createHash('sha256')`) e
  `URLSearchParams`.
- [ ] **Passo 4:** rodar. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: login OAuth do Google com PKCE e loopback`.

### Tarefa 5: Listagem recursiva da pasta

**Arquivos:**
- Criar: `server/src/drive/walk.ts`
- Teste: `server/src/drive/walk.test.ts`

**Interfaces:**
- Consome: `ClienteDrive`, `ArquivoDrive` (Tarefa 3); `VIDEO_EXTS`, `ScannedFile` (`scan/derive.ts`);
  `materialKind`, `MaterialKind` (`scan/walk.ts`).
- Produz:
  ```ts
  export interface ArquivoRemoto extends ScannedFile { remoteId: string; thumbnailLink: string | null; durationSec: number | null }
  export interface WalkDriveResult { titulo: string; videos: ArquivoRemoto[]; materials: Array<ArquivoRemoto & { kind: MaterialKind }> }
  export async function walkDrive(cliente: ClienteDrive, pastaId: string): Promise<WalkDriveResult>;
  ```
- Regras:
  - Se `getArquivo(pastaId)` não for pasta, lança `FalhaDrive('nao-e-pasta')`; o `titulo` é o `name`
    da pasta.
  - Os mapeamentos de campo:
    - `mtime = Math.floor(Date.parse(modifiedTime))`, a mesma unidade em ms do walk local;
    - `sizeBytes = Number(size ?? 0)`;
    - `durationSec = durationMillis / 1000`, ou `null`.
  - O `relPath` é montado com os nomes das pastas e é sempre separado por `/`.
  - Nomes que começam com `.` são ignorados, como no walk local. Também são ignorados os
    `application/vnd.google-apps.*`, exceto pasta e atalho.
  - Atalhos são resolvidos com `getArquivo(targetId)`: pasta entra na recursão, arquivo entra como
    arquivo com o nome do atalho.

- [ ] **Passo 1: testes**, com um `ClienteDrive` falso montado a partir de uma árvore em memória:
  - `'pasta com subpastas → relPath com nomes de pasta'`: `Módulo 1/01 Intro.mp4`.
  - `'vídeo vs material pela extensão'`: `.mp4` em `videos`, `.pdf` em `materials` com `kind:'pdf'`.
  - `'ignora Google Docs e nomes com ponto'`.
  - `'duração e tamanho vêm do Drive'`.
  - `'atalho para pasta entra como subpasta'`.
  - `'link de arquivo → nao-e-pasta'`.
  - **Ponto de revisão 1:** `'nomes repetidos na mesma pasta ganham sufixo'`. Dois `aula.mp4`, com
    `createdTime` 2026-01-02 e 2026-01-01, devem dar `aula.mp4` para o mais antigo e `aula (2).mp4`
    para o mais novo.
  - **Ponto de revisão 2:** `'barra no nome vira hífen'`. Uma pasta `A/B` deve dar o relPath `A-B/x.mp4`.
  - **Ponto de revisão 3:** `'atalho para pasta ancestral não entra em loop'`. A raiz contém um
    atalho para ela mesma. O resultado termina e lista cada vídeo uma vez só.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
  - A recursão leva um `Set` de ids de pasta já visitados.
  - O sufixo de duplicado entra antes da extensão: ordenar por `createdTime` e depois por `id`.
- [ ] **Passo 4:** rodar. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: listar pasta do Drive no formato do scan local`.

### Tarefa 6: Ingestão do curso do Drive

**Arquivos:**
- Modificar: `server/src/scan/scan-course.ts`. Extrair a inserção para
  `inserirCursoDerivado` sem mudar o comportamento de `createCourseFromPath`.
- Criar: `server/src/scan/scan-drive.ts`, `server/src/drive/servicos.ts`
- Teste: `server/src/scan/scan-drive.test.ts`; o `scan-course.test.ts` existente precisa continuar
  verde.

**Interfaces:**
- Consome: `walkDrive` (Tarefa 5), `deriveCourse`, `lessonThumbPath` (`media/thumbs.ts`), `ClienteDrive`.
- Produz:
  ```ts
  // scan-course.ts
  export interface OrigemCurso { title: string; rootPath: string; source: 'local' | 'drive'; driveFolderId?: string; driveResourceKey?: string | null }
  export interface ExtraRemoto { remoteId: string; durationSec: number | null }
  export function inserirCursoDerivado(db: Db, origem: OrigemCurso, derived: DerivedCourse,
    materials: Array<ScannedFile & { kind: MaterialKind }>, extras?: Map<string, ExtraRemoto>): string;
  // scan-drive.ts
  export interface DepsIngestao { cliente: ClienteDrive; fetch: Fetch; config: AppConfig; token: () => Promise<string | null> }
  export async function createCourseFromDrive(db: Db, deps: DepsIngestao, link: LinkDrive, linkOriginal: string):
    Promise<{ id: string; existente: boolean }>;
  export async function baixarCapasFaltando(db: Db, deps: DepsIngestao, courseId: string,
    capas: Map<string, string>): Promise<void>;   // relPath → thumbnailLink
  // servicos.ts — um ponto só que monta cliente + auth + deps a partir de db e fetch;
  // as Tarefas 7–9 recebem isto pelas opts dos plugins de rota
  export interface ServicosDrive { auth: AuthDrive; cliente(resourceKeys?: string | null): ClienteDrive; ingestao(resourceKeys?: string | null): DepsIngestao }
  export function criarServicosDrive(db: Db, config: AppConfig, fetch?: Fetch): ServicosDrive;
  ```
- Regras:
  - Se o `drive_folder_id` já existe nesta máquina, delega para `reconcileDriveCourse` (Tarefa 7) e
    devolve `existente: true`.
  - O `rootPath` é o `linkOriginal`.
  - As capas são baixadas **depois** da transação, com até 4 ao mesmo tempo. Com token, a requisição
    leva `Authorization`. O arquivo vai para `lessonThumbPath(config, id, mtime)` e a aula recebe o
    `thumb_path`.
  - Uma capa que falha é ignorada.

- [ ] **Passo 1: testes:**
  - `'cria curso drive com módulos, remote_id e duração'`: confere `source`, `drive_folder_id`,
    `root_path`, `remote_id` e `duration_sec` no banco.
  - `'capa baixada vai para thumbs e grava thumb_path'`.
  - `'falha de capa não impede o curso'`.
  - `'createCourseFromPath continua igual'`: o teste existente cobre.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar, refatorando `createCourseFromPath` para chamar `inserirCursoDerivado`
  com `source: 'local'`.
- [ ] **Passo 4:** `npm run test --workspace=server -- src/scan`. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: criar curso a partir de pasta do Drive`.

### Tarefa 7: Re-escanear curso do Drive

**Arquivos:**
- Modificar: `server/src/scan/reconcile.ts`. Extrair de `reconcileCourse` a função
  `aplicarReconcile`, sem mudar o comportamento local.
- Modificar: `server/src/routes/migration.ts`. O `rescan` escolhe o caminho pela `source`, e o
  `repoint`/`repoint/preview` de curso do Drive dá `409 { error: 'curso-do-drive' }`.
- Modificar: `server/src/scan/scan-drive.ts`
- Teste: `server/src/scan/scan-drive.test.ts`, `server/src/routes/migration.test.ts`

**Interfaces:**
- Produz:
  ```ts
  // reconcile.ts
  export function aplicarReconcile(db: Db, courseId: string, plan: ReconcilePlan,
    materials: Array<ScannedFile & { kind: MaterialKind }>, rootPath: string, extras?: Map<string, ExtraRemoto>): ReconcileResult;
  // scan-drive.ts
  export async function reconcileDriveCourse(db: Db, deps: DepsIngestao, courseId: string): Promise<ReconcileResult>;
  ```
- Regra: com `extras`, a atualização e a inserção de aula gravam `remote_id` e `duration_sec` vindos
  do Drive, e o material grava `remote_id`.

- [ ] **Passo 1: testes:**
  - `'rescan drive: aula nova entra, sumida fica missing, progresso preservado'`;
  - `'rescan drive atualiza remote_id de arquivo re-enviado com o mesmo nome'`;
  - `'repoint de curso drive → 409 curso-do-drive'`.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar. `reconcileCourse` passa a chamar `aplicarReconcile`. O `rescan` de
  curso do Drive recebe `ServicosDrive` (Tarefa 6) pelas `opts` do plugin; nos testes, montado com
  `fetch` falso.
- [ ] **Passo 4:** `npm run test --workspace=server`. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: re-escanear curso do Drive reaproveitando o planReconcile`.

### Tarefa 8: Repasse de stream e materiais

**Arquivos:**
- Criar: `server/src/drive/stream.ts`
- Modificar: `server/src/routes/stream.ts`, `server/src/routes/materials.ts`, `media/thumbs.ts`
  (`getOrCreateLessonThumb`), `server/src/routes/convert.ts`
- Teste: `server/src/drive/stream.test.ts`, `routes/stream.test.ts`, `routes/materials.test.ts`,
  `routes/convert.test.ts`

**Interfaces:**
- Consome: `ClienteDrive.baixar` (Tarefa 3).
- Produz `repassarDoDrive(req: FastifyRequest, reply: FastifyReply, cliente: ClienteDrive, remoteId: string,
  extra?: { contentType?: string; disposition?: string }): Promise<FastifyReply>`.
  - Copia o status (200/206/416) e os cabeçalhos `Content-Range`, `Content-Length`, `Content-Type`
    (ou o `extra.contentType`) e `Accept-Ranges: bytes`.
  - Envia o corpo com `Readable.fromWeb`.
  - Liga um `AbortController` a `req.raw.on('close')`.
  - Uma `FalhaDrive` vira `{ error: <tipo> }`: 403 para `sem-acesso`, 429 para `cota-esgotada`,
    503 para `sem-conexao`, 401 para `nao-autorizado`, 502 para `google`.
- As rotas recebem `drive?: ServicosDrive` (Tarefa 6) nas `opts`; a montagem em `app.ts` é da Tarefa 9. Quando a `source` é `'drive'`,
  vale isto:
  - **stream:** pula `arquivoDoCurso`, `isWithinRoots` e o convertido.
  - **materiais:** mantém os mesmos `Content-Disposition`, `nosniff` e CSP de SVG.
  - **`getOrCreateLessonThumb`:** devolve o arquivo se ele existir, senão `null`; nunca chama ffmpeg.
  - **`verify-playback`:** devolve `{ playable, reason: playable ? null : 'formato', remuxable: false }`.
  - **`convert`:** 409 `{ error: 'curso-do-drive' }`.

- [ ] **Passo 1: testes:**
  - `drive/stream.test.ts`:
    - `'206 com Content-Range repassado'`;
    - `'fecha a conexão → aborta o fetch'`: o `signal.aborted` fica `true`;
    - `'cota-esgotada → 429 { error }'`.
  - Um caso de curso do Drive em cada teste de rota já existente: `'curso drive repassa do Drive'`,
    `'material drive sai como attachment com download=1'` e `'convert drive → 409'`.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm run test --workspace=server`. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: repassar vídeos e materiais do Drive sob demanda`.

### Tarefa 9: Rotas do Drive e montagem

**Arquivos:**
- Criar: `server/src/routes/drive.ts`
- Modificar: `server/src/app.ts` (montar `ServicosDrive` e registrar no `// [ROUTES]`; passar `drive`
  para stream, materiais, thumbs, convert e migration), `server/src/routes/courses.ts` (os DTOs de
  lista e de detalhe ganham `source: 'local' | 'drive'`)
- Teste: `server/src/routes/drive.test.ts`

**Interfaces:**
- Consome: `ServicosDrive` (Tarefa 6).
- Produz: `buildApp(config, db, opts?: { fetch?: Fetch })`: o terceiro parâmetro é opcional e existe só para
  os testes.
- Rotas, com o contrato exato da spec:
  - `POST /api/drive/courses { link }`:
    - `400 { error:'link-invalido' }`;
    - `201 { id, existente:false }` ou `200 { id, existente:true }`;
    - sem token e com `sem-acesso` ou `nao-autorizado`: `401 { precisaAutorizar:true, url }`, com a
      `url` montada por `auth.iniciar('http://' + req.headers.host + '/api/drive/auth/callback')`;
    - com token e `sem-acesso`: `403 { error:'sem-acesso' }`;
    - `nao-e-pasta`: `400`;
    - `cota-esgotada`: `429`;
    - `sem-conexao`: `503`.
  - `GET /api/drive/auth/callback`: devolve `text/html` mínimo. A página faz
    `window.opener?.postMessage({ tipo:'learnflix-drive', ok, motivo }, location.origin)` e
    `window.close()`. O conteúdo vai escapado e a página leva `Content-Security-Policy` com hash ou
    nonce do script.
  - `GET /api/drive/status` → `{ conectado, email, credenciais: { clientId: boolean, clientSecret: boolean, apiKey: boolean } }`.
    Só booleanos, nunca os valores.
  - `DELETE /api/drive/auth` → 204.
  - `PUT /api/drive/credenciais { clientId?, clientSecret?, apiKey? }` → 204. Usa `salvarCredenciais`.

- [ ] **Passo 1: testes** com `app.inject` e `fetch` falso:
  - `'link inválido → 400'`;
  - `'pasta pública → 201 e curso com source drive'`;
  - `'privada sem login → 401 precisaAutorizar com url do Google e redirect no host da requisição'`;
  - `'privada com login → 403 sem-acesso'`;
  - **Ponto de revisão 4:** `'mesmo link duas vezes → mesmo id, existente:true, um curso só'`;
  - `'callback com state inválido devolve página que avisa ok:false'`;
  - `'status nunca devolve o token nem os valores das credenciais'`;
  - `'POST /api/drive/courses de outra origem → recusado pela guarda'`;
  - `'GET /api/courses/:id inclui source'`.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: rotas do Google Drive e login pelo popup`.

### Tarefa 10: Backup com cursos do Drive

**Arquivos:**
- Modificar: `server/src/backup/format.ts` (`ExportedCourse` ganha `source?`, `driveFolderId?` e
  `driveResourceKey?`, validados como opcionais), `backup/export.ts`, `backup/import.ts`
  (`ImportPlan.driveAusentes: string[]`)
- Modificar: `web/src/api/client.ts` (o tipo do plano de import) e o texto de prévia em `Settings.tsx`
- Teste: `backup/format.test.ts`, `backup/import.test.ts`, `backup/roundtrip.test.ts`

**Regras:**
- Um curso do Drive que existe aqui é reconhecido pelo `matchCourse` atual, por `root_path` ou por
  impressão digital, e o progresso é fundido.
- Um curso do Drive que **não** existe aqui não é criado e não conta em `created`. O título dele vai
  para `driveAusentes`.
- A prévia mostra a linha exata: "N curso(s) do Google Drive — adicione o link e importe de novo para
  trazer o progresso".

- [ ] **Passo 1: testes:**
  - `'export de curso drive leva source e driveFolderId'`;
  - `'backup antigo sem source continua válido'`;
  - `'import: curso drive presente funde progresso'`;
  - `'import: curso drive ausente vai para driveAusentes e não é criado'`.
- [ ] **Passo 2:** rodar. Esperado: FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npm test`. Esperado: PASSA.
- [ ] **Passo 5:** commit `feat: backup reconhece cursos do Google Drive`.

### Tarefa 11: Interface

**Arquivos:**
- Modificar: `web/src/api/client.ts`, `web/src/api/hooks.ts`
- Criar: `web/src/components/DriveLinkModal.tsx`
- Modificar: `web/src/pages/Library.tsx` (o menu "Adicionar ▾" ganha a opção **Do Google Drive**),
  `web/src/pages/Course.tsx` (selo "Google Drive"), `web/src/components/CourseMenu.tsx` (esconde
  "Re-apontar pasta…" quando `source === 'drive'`), `web/src/pages/Lesson.tsx`, `web/src/pages/Settings.tsx`

**Interfaces:**
- Consome as rotas da Tarefa 9.
- Produz em `client.ts`:
  ```ts
  export type RespostaDrive = { tipo: 'criado'; id: string; existente: boolean } | { tipo: 'autorizar'; url: string } | { tipo: 'erro'; erro: string };
  api.driveCriarCurso(link: string): Promise<RespostaDrive>;   // trata 401/403/4xx como valores, não exceções
  api.driveStatus(): Promise<{ conectado: boolean; email: string | null; credenciais: Record<'clientId'|'clientSecret'|'apiKey', boolean> }>;
  api.driveDesconectar(): Promise<void>;
  api.driveSalvarCredenciais(c: Partial<Record<'clientId'|'clientSecret'|'apiKey', string>>): Promise<void>;
  ```
- `source: 'local' | 'drive'` entra nos DTOs de curso.

**Comportamento e textos exatos:**
- **Modal de link:**
  - Rótulo "Link da pasta no Google Drive", botão "Adicionar".
  - Enquanto espera, o botão mostra "Lendo a pasta…" e fica desativado.
  - Na resposta `autorizar`, abre `window.open(url, 'learnflix-drive', 'width=500,height=650')`.
    Ao receber a `message` com `origin === location.origin` e `data.tipo === 'learnflix-drive'`,
    repete o pedido se `ok`. Se o popup for bloqueado, mostra um link "Abrir a autorização do Google".
  - Mensagens de erro:
    - `sem-acesso`: "Sua conta Google não tem acesso a esta pasta. Peça acesso ao dono do link."
    - `link-invalido`/`nao-e-pasta`: "Cole o link de uma pasta do Google Drive."
    - `cota-esgotada`: "O Google bloqueou downloads desta pasta por excesso de acessos. Tente de novo
      em algumas horas."
    - `sem-conexao`: "Sem conexão com o Google Drive."
  - Em caso de sucesso, navega para `/course/:id`.
- **Player:** no `onVideoError` de curso do Drive, faz
  `fetch('/api/lessons/:id/stream', { headers: { Range: 'bytes=0-0' } })`. Se a resposta for JSON
  com `error`:
  - `sem-conexao` e `cota-esgotada`: mostra os mesmos textos do modal;
  - `nao-autorizado`: mostra "A autorização do Google expirou." com o botão **Autorizar de novo**,
    que abre o popup pelo mesmo fluxo do modal.
  - Formato não tocável usa o aviso atual, sem o botão de converter.
- **Configurações, seção "Google Drive":**
  - Mostra "Conectado como {email} · Desconectar" ou "Nenhuma conta conectada".
  - Tem um `<details>` "Usar um app próprio do Google Cloud" com três campos e "Salvar". Os campos
    vêm vazios, com o placeholder "configurado" quando o status diz `true`.
- **Acessibilidade:** foco preso no modal, `Esc` fecha, contraste e foco visível do `DESIGN` atual
  (ver AGENTS.md).

- [ ] **Passo 1:** implementar seguindo os componentes vizinhos (`ConfirmDialog`, `TextField`,
  `RepointModal`).
- [ ] **Passo 2:** `npm run build`. Esperado: termina sem erro de tipo.
- [ ] **Passo 3:** commit `feat: adicionar curso do Google Drive pela interface`.

### Tarefa 12: Documentação, CI e checagem manual

**Arquivos:**
- Modificar:
  - `AGENTS.md`: as variáveis `GOOGLE_*`, o `drive/` na arquitetura e a origem do `GOOGLE_PADRAO`
    no `bundled.ts`.
  - `README.md`: a seção "Cursos do Google Drive", com o aviso de app não verificado e o teto de
    100 usuários.
  - `.github/workflows/release.yml`: os passos `npm run build` recebem
    `env: GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}` e o mesmo para `GOOGLE_CLIENT_SECRET` e
    `GOOGLE_API_KEY`.
  - `docs/specs/2026-10-12-curso-google-drive-design.md`: a seção Credenciais passa a descrever a
    injeção no build.

- [ ] **Passo 1:** escrever a documentação e mudar o workflow.
- [ ] **Passo 2: checagem manual** com `npm run dev`:
  - colar um link **público** real, ver aulas, capas e duração, abrir uma aula, pular para o meio e
    recarregar para conferir que a posição voltou;
  - colar um link **privado**, autorizar no popup e ver o curso entrar;
  - em Configurações, desconectar e conferir que a aula privada mostra "Autorizar de novo";
  - colar o mesmo link de novo e conferir que não duplica.
- [ ] **Passo 3:** `npm test && npm run build`. Esperado: tudo passa.
- [ ] **Passo 4:** commit `docs: cursos do Google Drive no README e no AGENTS.md`.
