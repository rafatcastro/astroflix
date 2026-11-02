# Cache de aulas, download offline e cache de capas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a janela automática das aulas remotas grava num cache com limite que se limpa sozinho, o "Baixar" continua permanente (promovendo o que já está no cache), e as capas passam a vir de uma fila com registro de falhas e capa própria pelo ffmpeg.

**Architecture:** dois módulos novos de servidor com fronteira clara — `server/src/cache-aulas.ts` (pasta + tabela `cache_aulas`) e `server/src/media/fila-capas.ts` (fila LIFO + tabela `capas_estado`) — ligados ao baixador (`drive/baixar.ts`), às rotas de stream, conversão, capas, cursos e armazenamento, e a duas mudanças de interface (Configurações e o componente `CapaAula`).

**Tech Stack:** Node ≥ 22.5 (`node:sqlite`), Fastify, TypeScript ESM sem extensão nos imports, React 18 + TanStack Query, Tailwind. ffmpeg opcional.

**Spec:** `docs/superpowers/specs/2026-10-31-download-opcional-e-cache-de-capas-design.md` (leia antes de cada tarefa; os valores abaixo saem de lá).

## Global Constraints

- Código, comentários e textos da interface em português; comentários explicam o porquê.
- Imports ESM sem extensão de arquivo. Schema só evolui com bloco `if (version < N && ate >= N)`; `ULTIMA_VERSAO` vai para 14. Nunca editar `SCHEMA_V1`.
- Tabelas novas (`cache_aulas`, `capas_estado`) são só locais: sem gatilhos da nuvem.
- Cache: `DATA_DIR/cache/<lessonId>.<ext>`; limite padrão 10 GB, aceito entre 2 e 100 GB (bytes, base 1024); chave `cache.limite` em `settings`.
- Janela: aula aberta + `JANELA` (2) próximas não concluídas. Folga no disco: 2 GB (`FOLGA_NO_DISCO`).
- Capas — esperas: `rede` 5 min (sem contar tentativa); `sem-capa` 1 h, 6 h, 24 h, depois 7 dias; `sem-ffmpeg` até abrir com ffmpeg. Fila máx. 500; rede simultânea: 3 Drive, 1 Telegram; ffmpeg 1 por vez, 30 s de limite; pausa se houve stream remoto nos últimos 30 s.
- `CapaAula`: novas tentativas em 5, 15 e 45 s.
- Pasta conectada nunca recebe arquivo do cache. "Limpar tudo" (`DELETE /api/armazenamento`) não toca o cache.
- Não há suíte de testes no repositório (removida a pedido). As verificações são scripts `node:assert` **fora do repositório**, em `$V=/private/tmp/claude-501/-Users-rafael-Projects-astroflix/0f05df91-c875-4649-ac17-e4bfd7582ac0/scratchpad/verificacao`, rodados com `cd /Users/rafael/Projects/astroflix/server && pnpm exec tsx $V/<arquivo>.ts`, importando de `/Users/rafael/Projects/astroflix/server/src/...` por caminho absoluto. Nunca usar `~/.astroflix` nem a sessão real (Telegram, conta).
- Commits locais na `main`, autor `Rafael <rafaelteicas@gmail.com>`, sem co-autor nem menção a IA. **Sem push** (cada push vira release).

## Review Focus

1. **Aula sendo tocada do cache enquanto `liberarCache` roda** — a aula aberta e a janela são protegidas; a pessoa nunca perde o arquivo que está assistindo. Teste em Task 2 (`protegidas nunca saem`) e Task 3 (janela atual é passada como protegida).
2. **"Baixar" de uma aula que está sendo gravada no cache naquele momento** — termina no cache e é promovida, sem baixar duas vezes. Teste em Task 3 (`promove ao baixar`).
3. **Pasta de armazenamento em outro disco** — promoção cai para cópia + apagar quando `rename` dá `EXDEV`. Teste em Task 2 (`promover com EXDEV copia`).
4. **App fechado no meio de um download para o cache** — o `.part` da aula da janela é retomado; o órfão é apagado na abertura. Teste em Task 4 (`varrerCache`).
5. **Rajada de capas ao rolar uma lista de 448 aulas** — a rota responde na hora, a fila não passa de 500 e não repete aula. Teste em Task 6 (`limite 500` e `pedido repetido sobe ao topo`).

---

### Task 1: Schema v14, `cacheDir` e base de verificação

**Files:**
- Modify: `server/src/db/index.ts` (bloco v14 depois do v13; `ULTIMA_VERSAO = 14`)
- Modify: `server/src/config.ts` (`cacheDir: string` em `AppConfig` e `loadConfig`: `path.join(dataDir, 'cache')`)
- Modify: `server/src/index.ts:28` (incluir `config.cacheDir` no laço de `mkdirSync`)
- Create: `$V/_base.ts` (fora do repo)

**Interfaces:**
- Produces: tabelas `cache_aulas` e `capas_estado` exatamente como na spec; `config.cacheDir`; em `$V/_base.ts`: `export function ambiente(): { db: Db; config: AppConfig; dir: string }` (DATA_DIR temporário via `fs.mkdtempSync`, `loadConfig({ DATA_DIR: dir })`, `openDb`, cria todos os diretórios) e `export function cursoRemoto(db: Db, opts?: { aulas?: number; source?: 'drive'|'telegram' }): { courseId: string; aulas: string[] }` (insere curso e aulas com `remote_id`, `size_bytes`, `order_index` crescentes, `container='mp4'`, `playable=1`).

- [ ] **Step 1: Escrever `$V/t1-schema.ts`** — com `ambiente()`: `assert.equal(pragma user_version, 14)`; `assert.ok` que `cache_aulas` tem colunas `lesson_id, arquivo, bytes, convertido, usado_em` e `capas_estado` tem `lesson_id, tentativas, proxima_em, motivo` (`PRAGMA table_info`); apagar a aula em `lessons` remove a linha das duas tabelas (cascade); `assert.equal(config.cacheDir, path.join(dir, 'cache'))`; nenhum gatilho em `sqlite_master` cita as duas tabelas.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm exec tsx $V/t1-schema.ts` → falha em `user_version` (13) ou `cacheDir` indefinido.
- [ ] **Step 3: Implementar** o bloco v14 (uma `transaction`, `CREATE TABLE` das duas e `pragma(db, 'user_version = 14')`, com comentário do porquê), `cacheDir` e o `mkdirSync`.
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando sai com código 0.
- [ ] **Step 5: Commit** — `git add server/src/db/index.ts server/src/config.ts server/src/index.ts && git commit -m "schema v14: cache_aulas e capas_estado; DATA_DIR/cache"`

### Task 2: Módulo `cache-aulas.ts`

**Files:**
- Create: `server/src/cache-aulas.ts`
- Create: `$V/t2-cache.ts`

**Interfaces:**
- Consumes: Task 1 (`config.cacheDir`, tabela); `registrarBaixado`, `destinoDe`, `protegido`, `type ItemBaixavel` de `./armazenamento`.
- Produces (todos exportados):
  - `LIMITE_PADRAO = 10 * 1024 ** 3`, `LIMITE_MIN = 2 * 1024 ** 3`, `LIMITE_MAX = 100 * 1024 ** 3`
  - `caminhoNoCache(config: AppConfig, lessonId: string, ext: string): string` → `cacheDir/<lessonId>.<ext>` (ext sem ponto, minúscula)
  - `arquivoEmCache(db: Db, lessonId: string): { arquivo: string; convertido: boolean } | null`
  - `registrarEmCache(db: Db, lessonId: string, arquivo: string, convertido: boolean): void` (bytes = `statSync`, `usado_em = Date.now()`, upsert)
  - `tocarCache(db: Db, lessonId: string): void`
  - `limiteDoCache(db: Db): number`; `definirLimiteDoCache(db: Db, bytes: number): boolean` (false fora do intervalo, sem gravar)
  - `usoDoCache(db: Db): { bytes: number; limite: number }`
  - `liberarCache(db: Db, protegidas: Set<string>): number` (bytes liberados)
  - `promoverDoCache(db: Db, config: AppConfig, item: ItemBaixavel): string | null` (caminho final, ou null se não estava no cache ou falhou)
  - `apagarCacheDoCurso(db: Db, courseId: string): void`; `limparCache(db: Db, config: AppConfig, exceto?: Set<string>): void`
  - `varrerCache(db: Db, config: AppConfig, janela: Set<string>): void`

- [ ] **Step 1: Escrever `$V/t2-cache.ts`** com casos nomeados (cada um um bloco com `console.log('ok', nome)`):
  - `arquivo sumido some da tabela`: registra, apaga o arquivo, `arquivoEmCache` → `null` e a linha some.
  - `limite fora do intervalo`: `definirLimiteDoCache(db, 1024**3)` → `false`, `limiteDoCache` continua `LIMITE_PADRAO`; `101 GB` → `false`; `5 GB` → `true`.
  - `concluídas saem primeiro`: limite 2 GB (via `definirLimiteDoCache`) e 3 arquivos esparsos de 1 GB (`fs.truncateSync`), A (concluída, `usado_em` mais novo), B e C (não concluídas, B mais antigo); `liberarCache(db, new Set())` apaga A antes de B; sobra `bytes ≤ 2 GB`; C fica.
  - `protegidas nunca saem`: mesmo cenário com todas protegidas → nada apagado, retorno 0.
  - `promove ao baixar`: aula no cache → `promoverDoCache` devolve `destinoDe(...)`, o arquivo está lá, `baixados` tem a linha com o mesmo `convertido`, `cache_aulas` não tem mais.
  - `promover com EXDEV copia`: com `fs.renameSync` substituído por uma função que lança `Object.assign(new Error(), { code: 'EXDEV' })` só para caminhos dentro de `cacheDir`, a promoção ainda funciona e o arquivo do cache some.
  - `apagar do curso`: dois cursos no cache; `apagarCacheDoCurso` apaga só arquivos e linhas do primeiro.
- [ ] **Step 2: Rodar e ver falhar** — erro de módulo `cache-aulas` inexistente.
- [ ] **Step 3: Implementar `server/src/cache-aulas.ts`** com comentário de cabeçalho (o cache é do app e é a exceção declarada ao "nada é apagado sozinho"). Ordem de `liberarCache`: `ORDER BY COALESCE(p.completed,0) DESC, c.usado_em ASC` com `LEFT JOIN progress p`. `promoverDoCache`: `renameSync`; em `EXDEV`, `copyFileSync` + `rmSync`; em qualquer outra falha devolve `null` sem tocar nas linhas. `varrerCache` fica para a Task 4 — exporte já com a assinatura e o corpo da Task 4.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `git commit -m "cache-aulas: pasta e tabela do cache automático, limite e promoção"`

### Task 3: Baixador grava a janela no cache

**Files:**
- Modify: `server/src/armazenamento.ts` (`ItemBaixavel` ganha `destino: 'cache' | 'armazenamento'`; cabeçalho cita o cache)
- Modify: `server/src/drive/baixar.ts` (`itemDe` recebe o destino; `pedirAula`, `baixarAula`, `itensDoCurso`, `baixarItem`, `rodarJanela`; comentário de cabeçalho)
- Create: `$V/t3-baixador.ts`

**Interfaces:**
- Consumes: Task 2 (`arquivoEmCache`, `registrarEmCache`, `caminhoNoCache`, `limiteDoCache`, `liberarCache`, `promoverDoCache`).
- Produces: `Baixador` com a mesma interface pública; comportamento novo:
  - `pedirAula` → itens `destino:'cache'`, pulando `arquivoBaixado` **e** `arquivoEmCache`.
  - `baixarAula` / `baixarCurso` → `destino:'armazenamento'`; se o item já estiver na janela como `'cache'`, troca para `'armazenamento'`.
  - Em `baixarItem`, item `'armazenamento'` com `arquivoEmCache` → `promoverDoCache`; se devolver caminho, segue para a conversão como hoje; se `null`, baixa da origem.
  - Item `'cache'`: se `item.tamanho > limiteDoCache(db)` pula sem erro; destino `caminhoNoCache(config, id, ext do rel_path)`; mesma folga no disco; ao terminar, aula não-foto passa por `prepararParaTocar(destino, <cacheDir>/<id>.convertendo.mp4, capacidadesSalvas(db))` e, se converteu, o `.mp4` substitui o original (`rename` + `rm`) e registra `convertido=true`; depois `registrarEmCache` e `liberarCache(db, protegidas)` com `protegidas = ids da janela atual + última aula pedida`.
  - Item `'cache'` que terminou enquanto já havia um pedido `'armazenamento'` para ele → promovido em seguida (o laço reavalia `janela[0]`).
  - Item `'cache'` nunca usa `destinoDe`, então nunca toca pasta conectada.

- [ ] **Step 1: Escrever `$V/t3-baixador.ts`** usando `criarBaixador({ db, config, fonte })` com uma `fonte` falsa que escreve `tamanho` bytes em `destino` (e opcionalmente espera um sinal para simular arquivo em andamento):
  - `janela vai para o cache`: 5 aulas, `pedirAula(a0)` + `aguardar()` → `cacheDir` tem a0, a1, a2; `baixados` vazio; pasta de armazenamento sem arquivos.
  - `pula o que está no cache`: segunda chamada não chama a fonte.
  - `pula concluída`: a1 concluída → janela pega a0, a2, a3.
  - `maior que o limite fica de fora`: `size_bytes` de a0 = 3 GB com limite 2 GB → fonte não é chamada para a0.
  - `promove ao baixar`: a0 no cache, `baixarAula(a0)` → fonte não chamada, `baixados` tem a0.
  - `baixar durante gravação no cache`: fonte segura a0; `baixarAula(a0)` no meio; liberar; `aguardar()` → fonte chamada **uma** vez para a0, a0 em `baixados`, fora do cache.
  - `limite respeitado`: limite 2 GB, aulas de 1 GB, abrir a0 e depois a3 → no fim `usoDoCache.bytes ≤ 2 GB` e a3, a4 presentes.
- [ ] **Step 2: Rodar e ver falhar** — `janela vai para o cache` falha (arquivo vai para `downloads`).
- [ ] **Step 3: Implementar** conforme Interfaces.
- [ ] **Step 4: Rodar e ver passar; rodar de novo `$V/t2-cache.ts`.**
- [ ] **Step 5: Commit** — `git commit -m "baixador: janela automática grava no cache; Baixar promove do cache"`

### Task 4: Rotas que leem e limpam o cache

**Files:**
- Modify: `server/src/routes/stream.ts` (ordem baixado → cache → origem; `tocarCache`)
- Modify: `server/src/routes/convert.ts` (`lessonPath` e `aulaDoDrive` consideram o cache; conversão manual de arquivo do cache vai para `<cacheDir>/<id>.convertendo.mp4` e substitui no cache com `convertido=true`; já convertido no cache → `{ playable: true }`)
- Modify: `server/src/routes/courses.ts:379` (`apagarCacheDoCurso` depois de `soltar`, antes do `DELETE`)
- Modify: `server/src/routes/armazenamento.ts` (`GET` inclui `cache: usoDoCache(db)`; `PUT /api/armazenamento/cache` `{ limite }` → 400 `limite-invalido` se `definirLimiteDoCache` devolver false, senão `liberarCache(db, janelaAtual)` e o uso; `DELETE /api/armazenamento/cache` → `limparCache` e o uso)
- Modify: `server/src/drive/baixar.ts` (`Baixador` ganha `janelaAtual(): Set<string>` — ids da janela + última pedida — e `pararCache(): Promise<void>`, que aborta e espera o item `'cache'` em andamento)
- Modify: `server/src/app.ts` (no `onReady` de `retomarDownloads`, `varrerCache(db, config, drive.baixador.janelaAtual())` antes de `retomar()`)
- Modify: `server/src/cache-aulas.ts` (corpo de `varrerCache`)
- Create: `$V/t4-rotas.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `GET /api/armazenamento` → `{ ...atual, cache: { bytes: number; limite: number } }`; `PUT /api/armazenamento/cache`; `DELETE /api/armazenamento/cache`; `Baixador.janelaAtual()` e `Baixador.pararCache()`.

- [ ] **Step 1: Escrever `$V/t4-rotas.ts`** com `buildApp(config, db, { supabase: null, telegram: <falso mínimo> })` e `app.inject`:
  - `stream do cache`: aula no cache com bytes conhecidos → `GET /api/lessons/:id/stream` com `Range: bytes=0-9` → 206, corpo igual aos 10 primeiros bytes; `usado_em` aumentou.
  - `baixado vence o cache`: a mesma aula em `baixados` com outro conteúdo → serve o baixado.
  - `verify com cache`: `POST /api/lessons/:id/verify-playback` não devolve `semArquivo` quando a aula está no cache.
  - `limite pela rota`: `PUT /api/armazenamento/cache {limite: 1}` → 400; `{limite: 5*1024**3}` → 200 e `GET` mostra `cache.limite` = 5 GB.
  - `limpar cache não toca downloads`: `DELETE /api/armazenamento/cache` → cache vazio, `baixados` intacto; `DELETE /api/armazenamento` → cache intacto.
  - `excluir curso apaga o cache dele`: `DELETE /api/courses/:id` → arquivos do curso fora de `cacheDir`.
  - `varrerCache`: em `cacheDir`, um arquivo sem linha, um `.part` de aula fora da janela e um `.part` de aula na janela; e uma linha cujo arquivo não existe → depois de `varrerCache(db, config, new Set([idDaJanela]))`, só sobra o `.part` da janela e a linha órfã some.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar; rodar `t2` e `t3` de novo.**
- [ ] **Step 5: Commit** — `git commit -m "stream, conversão, exclusão e Configurações passam a conhecer o cache de aulas"`

### Task 5: Interface — Configurações e aparência das aulas

**Files:**
- Modify: `web/src/api/client.ts` (`Armazenamento.cache: { bytes: number; limite: number }`; `api.limiteDoCache(limite: number)` → `PUT /api/armazenamento/cache`; `api.limparCache()` → `DELETE /api/armazenamento/cache`; comentário de `baixada` na linha 25)
- Modify: `web/src/pages/Settings.tsx` (`SecaoArmazenamento`: linha "Cache de aulas: X de Y", `<select>` com 2, 5, 10, 20, 50, 100 GB, botão "Limpar cache"; se o PUT falhar, o `<select>` volta ao valor anterior e aparece o aviso; texto: "Guarda a aula aberta e as próximas para abrirem sem esperar. Quando passa do limite, o app apaga as mais antigas sozinho." Atualizar o comentário do componente, que diz que o app nunca apaga nada sozinho)
- Modify: `web/src/components/LessonGrid.tsx:26-39`, `web/src/pages/Course.tsx:120-140` (tirar cinza/opacidade/texto apagado e o `title` "Não baixada"; `baixada === true` em curso remoto mostra um ícone pequeno com `title="Disponível offline"` e `aria-label` igual; `missing` igual)

**Interfaces:**
- Consumes: Task 4 (DTO e rotas).
- Produces: nada para outras tarefas.

- [ ] **Step 1: Implementar** seguindo `docs/design.md` (sem ornamento; contraste ≥ 4.5:1; foco visível no `<select>` e no botão). O ícone offline só aparece em curso remoto (`courseSource`/`source` diferente de local), já que no local `baixada` é sempre true.
- [ ] **Step 2: Build** — `cd /Users/rafael/Projects/astroflix && pnpm --filter web build` → sai com código 0, sem erro de tipo.
- [ ] **Step 3: Commit** — `git commit -m "interface: cache de aulas nas Configurações; aulas remotas sem cinza e com marca de offline"`

### Task 6: Fila de capas e rotas sem espera

**Files:**
- Create: `server/src/media/fila-capas.ts`
- Modify: `server/src/media/thumbs.ts` (dividir em `capaNoDisco` e `gerarCapa`; remover `capasDriveEmAndamento`)
- Modify: `server/src/media/ffmpeg.ts` (`extractFrame(entrada: string, atSec: number, outPath: string, opts?: { width?: number; timeoutMs?: number; headers?: string })`; ao estourar `timeoutMs`, `kill('SIGKILL')` e rejeita; `headers` vira `-headers` antes de `-i`)
- Modify: `server/src/routes/thumbs.ts` (as duas rotas: `capaNoDisco` → arquivo; senão `fila.pedir(id)` e 404 na hora)
- Modify: `server/src/routes/stream.ts` (chamada a `fila.videoRemotoTocando()` nos ramos de origem Drive/Telegram, exceto quando o cabeçalho `x-astroflix-capa: 1` vem na requisição)
- Modify: `server/src/app.ts` (criar a fila, passar a `thumbsRoutes` e `streamRoutes`; expor `definirPortaDasCapas(porta: number)` — por exemplo como `app.decorate` ou retorno extra — para o `index.ts`)
- Modify: `server/src/index.ts` (depois de `escutarComFallback`, informar a porta; no `onReady`, apagar `capas_estado` com `motivo='sem-ffmpeg'` se `hasFfmpeg()`)
- Modify: `server/src/scan/scan-drive.ts` (`baixarCapasFaltando`) e `server/src/scan/scan-telegram.ts` (`baixarCapas`): pular aula com `proxima_em > agora`; falha com exceção → `registrarFalhaDeCapa(db, id, 'rede')`
- Modify: `server/src/scan/reconcile.ts` (onde zera `thumb_path` por `mtime` novo, apagar também a linha de `capas_estado`)
- Modify: `server/src/cache-aulas.ts` e `server/src/armazenamento.ts` (`registrarEmCache` e `registrarBaixado` apagam a linha de `capas_estado` da aula)
- Create: `$V/t6-capas.ts`

**Interfaces:**
- Consumes: Task 2 (`arquivoEmCache`), `arquivoBaixado`, `ServicosDrive`, `ServicosTelegram`.
- Produces:
  - `capaNoDisco(db: Db, config: AppConfig, lessonId: string): string | null`
  - `gerarCapa(deps: DepsCapa, lessonId: string): Promise<'ok' | 'sem-capa' | 'sem-ffmpeg' | 'rede'>`
  - `type DepsCapa = { db: Db; config: AppConfig; drive?: ServicosDrive; telegram?: ServicosTelegram; porta: () => number | null; ffmpeg: () => boolean; extrair: typeof extractFrame; agora: () => number }`
  - `registrarFalhaDeCapa(db: Db, lessonId: string, motivo: 'rede' | 'sem-capa' | 'sem-ffmpeg', agora?: number): void` e `podeTentarCapa(db: Db, lessonId: string, agora?: number): boolean` (em `fila-capas.ts`)
  - `criarFilaCapas(deps: DepsCapa): FilaCapas & { definirPorta(p: number): void; aguardar(): Promise<void> }` com `FilaCapas` exatamente como na spec.
  - Ordem dentro de `gerarCapa`: arquivo local (baixado, cache ou curso local) com ffmpeg → origem → ffmpeg pela URL `http://127.0.0.1:<porta>/api/lessons/<id>/stream` com `headers: 'x-astroflix-capa: 1\r\n'` e `timeoutMs: 30_000`. Sucesso grava com `gravarCapaAtomico` + `UPDATE lessons SET thumb_path` + apaga `capas_estado`.

- [ ] **Step 1: Escrever `$V/t6-capas.ts`** com `criarFilaCapas` e `drive`/`telegram`/`extrair` falsos e `agora` controlável:
  - `rota responde na hora`: `GET /api/lessons/:id/thumb` sem capa → 404 em menos de 50 ms mesmo com a origem falsa demorando 2 s.
  - `LIFO`: pedir a, b, c com a origem travada no primeiro → ordem de atendimento depois do primeiro: c, b.
  - `pedido repetido sobe ao topo`: pedir a, b, a → a sai antes de b, e só uma vez.
  - `limite 500`: 600 pedidos com a fila travada → `size` interno ≤ 500 e os 100 primeiros descartados.
  - `espera sem-capa`: origem sem imagem e ffmpeg ausente → `capas_estado.motivo='sem-ffmpeg'`; com ffmpeg falso que não gera arquivo → `sem-capa`, `tentativas=1`, `proxima_em = agora + 1h`; repetindo com o tempo avançado → 6 h, 24 h, 7 dias, 7 dias.
  - `rede não conta tentativa`: origem lança → `motivo='rede'`, `tentativas` igual à anterior, `proxima_em = agora + 5 min`; antes disso `pedir` não chama a origem.
  - `pausa do ffmpeg`: `videoRemotoTocando()` e depois pedir aula sem miniatura → `extrair` não é chamado até `agora` passar 30 s.
  - `local primeiro`: aula no cache → `extrair` recebe o caminho do arquivo do cache, e a origem não é chamada.
  - `quadro real`: só se `hasFfmpeg()`: gerar um MP4 de 3 s com `ffmpeg -f lavfi -i testsrc=duration=3:size=320x240 -pix_fmt yuv420p`, servir com um `http.createServer` que usa `servirArquivo` (Range), chamar o `extractFrame` real com a URL e `timeoutMs: 30000` → arquivo `.jpg` com tamanho > 0. Sem ffmpeg, imprimir `pulado` e seguir.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** conforme Interfaces e a seção Parte 2 da spec. Limites de rede com `createLimiter` de `ffmpeg.ts` (3 Drive, 1 Telegram, 1 ffmpeg pela URL).
- [ ] **Step 4: Rodar e ver passar; rodar `t1`–`t4` de novo.**
- [ ] **Step 5: Commit** — `git commit -m "capas: fila LIFO com registro de falhas, capa própria pelo ffmpeg e rotas que não esperam a rede"`

### Task 7: Varredura de capas e componente `CapaAula`

**Files:**
- Modify: `server/src/media/thumbs.ts` (`varrerCapas(db: Db, config: AppConfig): void`)
- Modify: `server/src/app.ts` (chamar `varrerCapas` no `onReady` de `retomarDownloads`, junto de `varrerCache`)
- Create: `web/src/components/CapaAula.tsx`
- Modify: `web/src/components/LessonGrid.tsx`, `web/src/components/PlaylistSidebar.tsx`, `web/src/pages/Course.tsx` (capas de aula e de curso), `web/src/pages/Library.tsx` (capas de curso)
- Create: `$V/t7-varredura.ts`

**Interfaces:**
- Produces: `CapaAula(props: { src: string; className?: string; alt?: string; loading?: 'lazy' | 'eager' }): JSX.Element` — mesmo `<img>` atual; no `onError` fica oculta e, depois de 5, 15 e 45 s, troca `src` acrescentando `?t=<n>` (ou `&t=<n>` se já houver `?`); ao mudar `src`, zera; limpa o timer ao desmontar; ao carregar, volta a ficar visível.
- `varrerCapas` remove em `thumbsDir` só: `*.tmp`; `^<uuid>-<digitos>\.jpg$` cuja aula não existe ou cujo `mtime` difere do atual. Nunca `course-*` nem `documento-*`.

- [ ] **Step 1: Escrever `$V/t7-varredura.ts`**: cria em `thumbsDir` `x.jpg.123.abc.tmp`, `<aulaExistente>-<mtimeAtual>.jpg`, `<aulaExistente>-1.jpg`, `<uuidInexistente>-5.jpg`, `course-<id>.jpg`, `documento-<id>.png` → depois de `varrerCapas`, sobram exatamente o da aula atual, `course-*` e `documento-*`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `varrerCapas`, o componente e a troca nos quatro arquivos. `Lesson.tsx:123` não muda.
- [ ] **Step 4: Rodar `t7` e ver passar; `pnpm --filter web build` sem erro.**
- [ ] **Step 5: Commit** — `git commit -m "capas: varredura de órfãs ao abrir; CapaAula tenta de novo até a capa ficar pronta"`

### Task 8: Documentação, build e instalador

**Files:**
- Modify: `AGENTS.md` (downloads: janela → cache, pedidos explícitos → armazenamento, cache como exceção ao "nada é apagado sozinho"; `DATA_DIR` com `cache/`; `media/` com a fila de capas; modelo de dados com `cache_aulas` e `capas_estado`)

- [ ] **Step 1: Atualizar `AGENTS.md`** nos pontos acima, no estilo do arquivo.
- [ ] **Step 2: Build completo** — `cd /Users/rafael/Projects/astroflix && pnpm build` → código 0.
- [ ] **Step 3: Rodar todos os scripts** — `for f in $V/t*.ts; do (cd server && pnpm exec tsx $f) || break; done` → todos passam.
- [ ] **Step 4: Commit** — `git commit -m "AGENTS.md: cache de aulas e fila de capas"`
- [ ] **Step 5: Instalador local** — conferir `.google-oauth.local.json`, `.supabase.local.json`, `.telegram.local.json` e `.tauri-signing.local.key` na raiz; com o Node 22 do fnm e o rustup no PATH e as variáveis de assinatura, rodar em segundo plano `pnpm build && pnpm build:binario && node scripts/preparar-sidecar.mjs && node scripts/sincronizar-versao.mjs 2.1.999 && pnpm --filter desktop tauri build`; depois `git checkout -- package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock` e `open -R desktop/src-tauri/target/release/bundle/dmg/Astroflix_2.1.999_aarch64.dmg`.
- [ ] **Step 6: Checagem manual** (pela pessoa, no app instalado): abrir uma aula remota → ela e as 2 próximas aparecem em `~/.astroflix/cache`, nada novo em `downloads`; Configurações mostram o cache; capas do curso aparecem ou o motivo está em `capas_estado`.
