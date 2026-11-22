# Árvore de módulos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** curso local/Drive mostra a árvore das pastas em qualquer profundidade (sem mapeamento); o Telegram ganha submódulos no mapeamento e pré-montagem pelo "Menu" de hashtags.

**Architecture:** a página monta a árvore de um caminho por aula: o das pastas do `rel_path` (local/Drive) ou o de `lessons.module` dividido por "/" (Telegram). O mapeamento só existe para o Telegram e grava o módulo como caminho `"A/B"`. O guia de hashtags é aplicado no scan do Telegram como o módulo das aulas não mapeadas, então a tela de mapeamento já abre montada.

**Tech Stack:** TypeScript, Fastify, `node:sqlite`, GramJS, React 18 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-22-arvore-de-modulos-design.md`

## Global Constraints

- Sem suíte de testes (removida a pedido, AGENTS.md). Cada tarefa se verifica com `pnpm build:servidor` (o `tsc --noEmit` de cada workspace) e, nas funções puras, com um script descartável em `tsx` no scratchpad, que **não** é commitado.
- Código e comentários em português; os comentários explicam o porquê.
- Schema: só um bloco novo `if (version < 17 && ate >= 17)` em `server/src/db/index.ts`; nada no Supabase.
- `rel_path` nunca muda (é a identidade da aula na nuvem e no progresso).
- Profundidade máxima de módulo no mapeamento: **5 níveis**. Pasta de materiais: `/^(materia(l|is)|apoio|anexos?)\b/i` sobre o nome sem número inicial. Guia: **≥ 3** hashtags que batem com as legendas; empate → mensagem mais nova; candidatas = fixadas + as **50 primeiras** mensagens de texto.
- Um commit só na `main` no fim (Tarefa 8), com `pnpm build` antes.

**Desvio do spec (decisão do plano):** para local/Drive a árvore continua saindo do `rel_path` (o código que já funciona hoje sem mapeamento) e `derive.ts` mantém `module` = 1º segmento; só o título deixa de levar as pastas. Assim nenhum curso local/Drive precisa ter o `module` regravado.

## Review Focus

1. Curso local com uma pasta só embrulhando tudo ("Docker/…"): a pasta-embrulho não aparece (como hoje). → verificação na Tarefa 2.
2. Telegram mapeado com **um** módulo só contendo todas as aulas: o módulo aparece (a regra do embrulho não vale para o Telegram). → Tarefa 2.
3. Dois arquivos "Aula 01.txt" e "Aula 01.pdf" para a mesma aula: o .txt é a descrição, o .pdf aparece logo abaixo da aula. → Tarefa 2.
4. Menu do Telegram com linhas que não são módulo ("Clique aqui…", "Via @…", "-") e hashtag sem vídeo correspondente: não criam módulo vazio. → Tarefa 5.
5. Curso do Drive já mapeado e com "Baixar" feito: depois da v17 os arquivos voltam para a estrutura das pastas e continuam tocando. → Tarefa 4.

---

### Task 1: Título sem as pastas coladas

**Files:**
- Modify: `server/src/scan/derive.ts` (`deriveCourse`, bloco `deeper`)

**Interfaces:**
- Produces: `DerivedLesson.title` = `cleanTitle(nome do arquivo)`, sempre.

- [ ] **Step 1:** Em `deriveCourse`, o título passa a ser só `cleanTitle(filename)`; remova `deeper` e o comentário "aninhamento mais profundo é dobrado no título".
- [ ] **Step 2:** `pnpm build:servidor` → termina sem erro de tipo.

(O re-escaneio já atualiza títulos não editados via `COALESCE(titulo_editado, @title)` em `reconcile.ts`; os existentes são corrigidos na Tarefa 4.)

### Task 2: A árvore e as regras dos arquivos (`web/src/lib/arvore.ts`)

**Files:**
- Modify: `web/src/lib/arvore.ts`
- Modify: `web/src/pages/Course.tsx:197`, `web/src/components/PlaylistSidebar.tsx:29` (chamadas)
- Modify: o componente que desenha os nós da árvore na página do curso (procure `tipo === 'material'` em `Course.tsx`) para desenhar `anexos`.

**Interfaces:**
- Produces:
  - `export function montarArvore(aulas: LessonDTO[], materiais?: MaterialDTO[], origem?: 'local' | 'drive' | 'telegram'): No[]` — `origem` padrão `'local'`.
  - `export function ligacoesDasAulas(aulas: LessonDTO[], materiais: MaterialDTO[]): { descricoes: Map<string, MaterialDTO>; anexos: Map<string, MaterialDTO[]> }` (chave = id da aula).
  - `descricoesDasAulas(aulas, materiais)` continua exportada, = `ligacoesDasAulas(...).descricoes` (usada por `MapearCurso` e `DescricaoDaAula`).
  - O nó de aula ganha `anexos: MaterialDTO[]`: `{ tipo: 'aula'; aula; titulo; anexos }`.
  - `export const DOCUMENTO = /\.(txt|md|markdown|pdf|docx?)$/i` (candidatos a ligação); `DESCRICAO` fica `/\.(txt|md|markdown|pdf|docx)$/i` (o que o visualizador mostra como descrição; `.doc` só pode ser anexo).
- Remove: `arvoreMapeada` (substituída pelo caminho do módulo).

- [ ] **Step 1: Caminho de cada aula.** `caminho(l) = origem === 'telegram' ? (l.module?.split('/').filter(Boolean) ?? []) : pastasDe(l.relPath)`. Para materiais, sempre `pastasDe(relPath)`. A regra da pasta-embrulho (`comum`) só vale quando `origem !== 'telegram'`. O corte do prefixo antigo do título ("B / C — ") continua (cursos não re-escaneados).
- [ ] **Step 2: Ligações.** Em `ligacoesDasAulas`, as chaves de hoje (mesmo nome; sem "Descrição"; "Aula N") passam a valer para todo `DOCUMENTO` (a de "Aula N" deixa de ser só txt/md). Onde procurar a aula de um material, em ordem: a pasta dele; a pasta dele sem o segmento de materiais (`"Mod/Materiais/x.pdf"` → `"Mod"`, `"Materiais/Mod/x.pdf"` → `"Mod"`, `"Materiais/x.pdf"` → raiz); subir 1 e 2 níveis (como hoje); por último, o nome no curso todo se só uma aula tem a chave (como hoje, `b.length >= 6`, e agora também "Aula N" único no curso). Todos os materiais ligados à mesma aula ficam com ela; **descrição** = o primeiro por prioridade de extensão txt/md > docx > pdf que case com `DESCRICAO` (respeitando `l.descricao` escolhida, como hoje); os demais vão para `anexos`, na ordem natural do nome. Os arquivos da "pasta com o nome da aula" (`aulaDaPasta` de hoje) também viram anexos.
- [ ] **Step 3: Ordem dentro da pasta.** Ao fim da montagem, cada `filhos` é reordenado de forma estável: (1) pastas com aula, na ordem de entrada (servidor); (2) aulas, na ordem do servidor; (3) materiais soltos, ordem natural do nome; (4) pastas sem aula (só arquivos), ordem natural do nome. Materiais ligados não entram como nó próprio, então a pasta de materiais toda ligada não é criada.
- [ ] **Step 4: Desenhar os anexos.** Na página do curso e na `PlaylistSidebar`, os `anexos` de uma aula aparecem logo abaixo dela com o mesmo componente/estilo de material já usado, com recuo de um nível. Passe `data.source` como `origem` nas duas chamadas.
- [ ] **Step 5: Verificação das regras (script descartável).** Em `<scratchpad>/arvore-check.ts`, importe `montarArvore` de `web/src/lib/arvore.ts` e confira com `node:assert` (rodar `pnpm --filter web exec tsx <script>`):
  - local `["Docker/01 A/a1.mp4","Docker/01 A/a2.mp4","Docker/02 B/b1.mp4"]` → raiz = `[pasta "01 A", pasta "02 B"]` (embrulho some).
  - local `["Curso/02 DascIA/01 Fund/Aula 01 - Intro.mp4","Curso/02 DascIA/02 Note/x.mp4"]` → `02 DascIA` com filhos `01 Fund` e `02 Note`; título do nó `"Aula 01 - Intro"`.
  - materiais `["01 Claude/links.pdf","01 Claude/MODULO X.pdf"]` com aulas `01 Claude/Aula 01 - Intro.mp4`, `01 Claude/Aula 02 - Resumo.mp4` → filhos de `01 Claude`: aula, aula, `links.pdf`, `MODULO X.pdf`.
  - `"01 Claude/Materiais/Resumo Aula 01.txt"` e `"01 Claude/Materiais/Slides Aula 01.pdf"` → descrição da Aula 01 = o .txt, `anexos` = [o .pdf]; nenhuma pasta "Materiais" na árvore.
  - `"Arquivos gerais/a.pdf"` ao lado de `"01 X/…mp4"` e `"02 Y/…mp4"` → raiz = `[01 X, 02 Y, Arquivos gerais]`.
  - telegram, todas as aulas com `module: "M1"` → raiz = `[pasta "M1"]`; `module: "A/B"` → `A > B > aula`.
  Esperado: o script termina sem `AssertionError`.
- [ ] **Step 6:** `pnpm build:servidor` → sem erro de tipo.

### Task 3: Mapeamento só no Telegram, com submódulos

**Files:**
- Modify: `server/src/routes/courses.ts:53`, `server/src/routes/drive.ts:45` (remover `mapa_pendente=1`)
- Modify: `server/src/routes/mapa.ts` (`nomeDoModulo`, recusa fora do Telegram)
- Modify: `server/src/armazenamento.ts:134-145` (`partesDaAulaMapeada`)
- Modify: `web/src/components/CourseMenu.tsx:424`, `web/src/pages/Course.tsx` (abertura automática/`?mapear=1`)
- Modify: `web/src/components/MapearCurso.tsx`, `web/src/components/AulasNovas.tsx`

**Interfaces:**
- Produces: `lessons.module` do Telegram mapeado = caminho `"A/B"` (partes saneadas, sem "/" dentro, ≤ 5 níveis, cada parte ≤ 120 caracteres). `MapaModulo.nome` carrega esse caminho.

- [ ] **Step 1: Servidor.** Tire o `mapa_pendente=1` de `courses.ts` e `drive.ts` (fica só em `telegram.ts`). `PUT /api/courses/:id/mapa` e `POST .../mapa/aulas` respondem `400 { error: 'so-telegram' }` se `source !== 'telegram'` (o `/mapa/pular` continua aceitando qualquer curso, para limpar pendências antigas). `nomeDoModulo(n)`: divide por "/", saneia cada parte com a regra de hoje, descarta partes vazias, corta em 5, junta com "/"; vazio → `null`.
- [ ] **Step 2: Baixar com níveis.** `partesDaAulaMapeada` gera uma pasta por nível: para o nível k, os irmãos são os prefixos distintos de comprimento k+1 com o mesmo pai, ordenados por `MIN(order_index)` das aulas debaixo deles; nome `sanear(\`${numero(i+1, irmãos)} - ${parte}\`, 120)`. A aula continua `NN - Título.ext`, numerada entre as aulas com exatamente o mesmo `module`.
- [ ] **Step 3: Interface.** `CourseMenu` mostra "Organizar módulos e aulas…" só quando `course.source === 'telegram'`; `Course.tsx` ignora `?mapear=1` e `mapaPendente` fora do Telegram.
- [ ] **Step 4: Submódulos na tela.** Em `MapearCurso`, `Grupo.nome` passa a ser o caminho completo; a lista de grupos continua plana, na ordem de exibição (pai antes dos filhos). Cada módulo mostra só a última parte (editável), com recuo `pl-[nível*1rem]`. Ações novas/alteradas:
  - "+ Submódulo" no cabeçalho do módulo (escondido no nível 5): cria `"<pai>/Novo submódulo"` (com sufixo " 2", " 3"… se repetir) logo depois do último descendente do pai, foco no nome.
  - Renomear a parte de um módulo troca o prefixo de todos os descendentes; "/" digitado vira "-".
  - "Desfazer o módulo" leva as aulas dele para o pai (ou "Fora dos módulos" no 1º nível) e sobe os submódulos um nível.
  - Validação de nomes duplicados compara caminhos completos.
  - Os seletores de módulo (mover marcadas) e `AulasNovas` mostram o caminho como `"A › B"`.
  - Ao salvar, módulos sem aula em si **nem** nos descendentes não vão; os pais vazios com filhos não precisam ir (existem pelo caminho dos filhos).
- [ ] **Step 5:** `pnpm build:servidor` → sem erro de tipo.

### Task 4: Migração v17 — devolver às pastas os cursos local/Drive mapeados

**Files:**
- Modify: `server/src/db/index.ts` (bloco `version < 17`, ajustar `ate`/versão máxima se houver constante)
- Modify: `server/src/index.ts` (depois do `openDb`, antes do `buildApp`)

**Interfaces:**
- Consumes: `deriveCourse`, `cleanTitle` (`server/src/scan/derive.ts`); `reorganizarBaixados(db, config, courseId)` (`server/src/armazenamento.ts:563`).
- Produces: `settings` chave `mapa.reorganizar` = JSON `string[]` dos cursos do Drive a reorganizar; apagada depois de consumida.

- [ ] **Step 1: Migração.** Numa `transaction`: para cada curso `source IN ('local','drive')`: (a) se tiver aula `mapeada=1`: rode `deriveCourse` sobre todas as aulas do curso (`relPath`, `sizeBytes`, `mtime` das colunas) e grave por `rel_path` `module`, `module_order`, `order_index`, `mapeada=0`; `courses.structure` = o do derive; se for `drive`, acrescente o id em `mapa.reorganizar`; (b) em todos: `title = cleanTitle(basename(rel_path))` onde `titulo_editado IS NULL`; (c) `mapa_pendente=0`. `titulo_editado` e `descricao_rel` ficam. Os gatilhos da nuvem sobem as mudanças (não ligar `aplicando`). `user_version = 17`.
- [ ] **Step 2: Reorganizar baixados.** Em `index.ts`, logo após `openDb`: lê `mapa.reorganizar`, chama `reorganizarBaixados(db, config, id)` para cada um (nada está baixando ainda: o `buildApp` ainda não retomou downloads), apaga a chave. Erro num curso não para os outros (try/catch por curso, `console.error`).
- [ ] **Step 3: Verificação.** Copie `~/.astroflix/app.db` para o scratchpad e rode o servidor contra ele (`DATA_DIR=<scratchpad>/dados pnpm --filter server exec tsx src/index.ts`, com o `app.db` copiado dentro). Esperado: `sqlite3 <copia> "PRAGMA user_version"` → 17; `SELECT count(*) FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.source IN ('local','drive') AND l.mapeada=1` → 0; o curso "02. Cursos DascIA Academy" tem `title` sem " — ".

### Task 5: Guia de módulos do Telegram — leitura pura

**Files:**
- Create: `server/src/telegram/guia.ts`
- Modify: `server/src/telegram/mensagens.ts` (hashtags e título)

**Interfaces:**
- Produces:
  - `export interface GuiaModulo { modulo: string; tags: string[] }` (tags minúsculas, sem "#").
  - `export function hashtagsDe(texto: string): string[]` — `/#([\p{L}\p{N}_]+)/gu`, minúsculas, sem repetir, na ordem.
  - `export function lerGuia(texto: string): GuiaModulo[]` — linha não vazia sem hashtag abre um título pendente (sem `=`, `-`, `•`, `*`, `>` e espaços nas pontas; linha que fica vazia, como "-", é ignorada); hashtags seguintes vão para o último título pendente; títulos sem hashtag depois não geram módulo; nome com "/" vira "-", até 120 caracteres.
  - `export function escolherGuia(textos: MensagemTelegram[], tagsDoCurso: Set<string>): GuiaModulo[] | null` — para cada texto, conta hashtags de `lerGuia` que estão em `tagsDoCurso`; vence a maior contagem (≥ 3), empate → maior `id`; devolve o guia sem as tags que não estão no curso e sem módulos que ficaram vazios.
  - `ArquivoTelegram` ganha `hashtags: string[]` (da legenda inteira).
  - Título do vídeo em `montarCurso`: 1ª linha da legenda **sem as hashtags** (trim); vazio → nome do arquivo limpo; ainda vazio → `#tag` original da legenda, se houver; senão o padrão de hoje.

- [ ] **Step 1: Implementar** `guia.ts` e as mudanças de `mensagens.ts` com as assinaturas acima.
- [ ] **Step 2: Verificação (script descartável).** Com o texto do menu do print (`"Clique aqui para ver o Menu. Utilize as # para saltar entre os vídeos.\n\nDocuments\n#Doc001\n\n= Módulo 00 - SEJA BEM-VINDO (A)! Comece por aqui\n#D001 #D002 #D003\n\n= Módulo 01 - PROSPECÇÃO DE CLIENTES\n#D004 #D005\n#D006\n\n-\nVia @D_er_Academy"`), `lerGuia` → `[{modulo:'Documents',tags:['doc001']},{modulo:'Módulo 00 - SEJA BEM-VINDO (A)! Comece por aqui',tags:['d001','d002','d003']},{modulo:'Módulo 01 - PROSPECÇÃO DE CLIENTES',tags:['d004','d005','d006']}]`; `escolherGuia([msg], new Set(['d001','d002','d004']))` → 2 módulos (Documents some), e com só 2 tags no curso → `null`. `montarCurso` de uma mensagem com legenda `"#D004 Como achar clientes"` → título `"Como achar clientes"`, `hashtags: ['d004']`.
- [ ] **Step 3:** `pnpm build:servidor` → sem erro de tipo.

### Task 6: Guia de módulos do Telegram — buscar e aplicar no scan

**Files:**
- Modify: `server/src/telegram/cliente.ts` (interface), `server/src/telegram/gramjs.ts` (implementação)
- Modify: `server/src/scan/scan-telegram.ts` (`derivar` e os dois chamadores)

**Interfaces:**
- Consumes: Tarefa 5.
- Produces: `ClienteTelegram.textos?(peer: PeerTelegram): Promise<MensagemTelegram[]>` — opcional (os clientes falsos não têm); `derivar(curso, topicos, guia: GuiaModulo[] | null)`.

- [ ] **Step 1: `textos` no GramJS.** Mensagens fixadas (`InputMessagesFilterPinned`, por `buscar` quando `peer.topico`, senão `iterMessages` com o filtro) mais as 50 mais antigas (`iterMessages(peer, { reverse: true, limit: 50 })`; num tópico, só as fixadas). Só as com texto e sem mídia, sem repetir id. Falha que não seja sessão/flood/conexão → `[]` (o guia é enfeite, como os tópicos).
- [ ] **Step 2: Aplicar.** Nos dois chamadores: `const guia = escolherGuia(await deps.cliente.textos?.(peer) ?? [], new Set(curso.videos.flatMap((v) => v.hashtags)))`. Em `derivar`, com guia: a aula cuja `hashtags` contém uma tag do guia ganha `module` = nome do módulo do guia (o primeiro em que aparece); ordem: as fora do guia primeiro (`module=null`, ordem de postagem), depois módulo a módulo na ordem do guia, aulas na ordem das tags; `orderIndex`/`moduleOrder` recalculados; `structure='modules'`. O guia substitui os tópicos quando os dois existem. Aulas mapeadas não mudam (o `reconcile` já preserva), então as novas chegam com o módulo do guia e o `AulasNovas` já o sugere (`sugestao` usa `l.module` se estiver nos módulos).
- [ ] **Step 3:** `pnpm build:servidor` → sem erro de tipo.
- [ ] **Step 4: Verificação manual.** Importar (ou re-escanear) no app de desenvolvimento (`pnpm dev`) um canal com menu de hashtags: a tela de mapeamento abre com os módulos do menu na ordem dele.

### Task 7: AGENTS.md

**Files:**
- Modify: `AGENTS.md` (parágrafo "Mapeamento do curso", `telegram/`, `VisualizadorArquivo`/descrição)

- [ ] **Step 1:** Atualizar: mapeamento só no Telegram (local/Drive = árvore das pastas, a v17 desfez os mapeados), módulo como caminho `"A/B"` até 5 níveis e o "Baixar" em `NN - A/NN - B/`, o guia de hashtags (fixadas + 50 primeiras, ≥ 3 tags), as regras dos arquivos (ligação por "Aula N" para todo documento, pastas de materiais, anexos abaixo da aula, ordem: pastas com aula, aulas, arquivos, pastas só de arquivos) e o título sem as pastas.

### Task 8: Build, commit e push

- [ ] **Step 1:** `pnpm build` → termina e mostra o instalador em `desktop/src-tauri/target/release/bundle`.
- [ ] **Step 2: Conferência no app instalado.** Abrir o curso "02. Cursos DascIA Academy": as 10 pastas aparecem como módulos, com os títulos sem o nome da pasta; o menu ⋯ não tem "Organizar…".
- [ ] **Step 3: Commit único na `main` e push** (inclui spec, plano e os arquivos de versão que o `pnpm build` gravou):

```bash
git add -A
git commit -m "árvore de módulos: curso local/Drive mostra as pastas em qualquer profundidade (sem mapeamento; a v17 desfaz os mapeados e os títulos perdem as pastas); mapeamento só no Telegram, com submódulos (module = \"A/B\", Baixar em NN - A/NN - B) e pré-montado pelo menu de hashtags do canal; arquivos ligados à aula por \"Aula N\" em qualquer documento, anexos abaixo da aula e pastas só de arquivos no fim

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
