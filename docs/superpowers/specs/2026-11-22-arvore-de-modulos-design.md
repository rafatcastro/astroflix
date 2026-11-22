# Árvore de módulos: o curso como as pastas dele

## Por quê

Um curso importado de uma pasta com subpastas ("02. Cursos DascIA Academy/01. Fundamentos da IA/…")
aparecia como uma lista corrida de 532 aulas: todas as pastas sumiram. A causa é o mapeamento
(v16): ele abre sozinho ao importar, só conhece **um nível** de módulo (o 1º segmento do
`rel_path`, `derive.ts`) e, depois de salvo (`lessons.mapeada=1`), a página desenha só esse nível
(`arvoreMapeada`), com o resto das pastas colado no título ("01. Fundamentos… — Aula X").

Para quem usa, **cada pasta do disco é um módulo** e o app tem de mostrar o que o Finder mostra.

## Objetivos

- Pasta local e Google Drive: o curso é a árvore das pastas, em qualquer profundidade. A tela de
  mapeamento **não abre** ao importar e o "Organizar módulos e aulas…" sai do menu ⋯ desses cursos.
- Telegram (sem pastas): o mapeamento continua abrindo ao importar e passa a aceitar **módulos
  dentro de módulos**. O "Baixar" cria as pastas com essa estrutura.
- Os arquivos que não são vídeo seguem as regras abaixo.
- O curso já estragado (local/Drive com `mapeada=1`) volta sozinho para a árvore das pastas.
- No Telegram, quando o canal tem um "Menu" com hashtags, o mapeamento já abre montado por ele.

**Fora:** descrição de módulo como recurso próprio (o arquivo com o nome do módulo aparece como
arquivo comum); mexer na pasta de origem (continua só-leitura).

**Anti-objetivo:** perder progresso, título renomeado pela pessoa ou o que já foi baixado.

## Abordagens

1. **Módulo como caminho na coluna existente** (`lessons.module = "A/B"`, "/" separa níveis). Sem
   tabela nova, sem mudança no Supabase; uma árvore só para local, Drive e Telegram. Renomear um
   módulo pai reescreve o caminho das aulas de dentro (uma transação). **Escolhida.**
2. Tabela de módulos (id, pai, nome, ordem) com a aula apontando para o id. Melhor para renomear,
   mas pede tabela nova no SQLite e no Supabase, gatilhos, migração e `schema.sql` novo, para um
   caso (Telegram) de poucos módulos. Descartada.
3. Árvore em JSON no curso. Briga com a sincronização por aula. Descartada.

## Desenho

### Scan e títulos (`derive.ts`, `reconcile.ts`)
- `module` passa a ser o caminho inteiro da pasta da aula (`"A/B"`, `null` na raiz).
  `module_order` segue a ordem natural do caminho.
- O título deixa de levar as pastas coladas ("B / C — Aula"): fica só o nome do arquivo limpo. O
  re-escaneio atualiza os títulos não editados (`COALESCE(titulo_editado, …)` já faz isso).

### Árvore (`web/src/lib/arvore.ts`)
- Uma função só monta a árvore a partir de `module` (caminho) para todo curso. Para local/Drive o
  caminho é o das pastas; para o Telegram mapeado, o da pessoa. Continua valendo: tirar a pasta
  que embrulha o curso inteiro.
- Ordem dentro de cada pasta: **subpastas com aula** (na ordem do servidor), **aulas**, depois os
  **arquivos**, depois as **pastas só com arquivos** (ordem natural entre elas). Isso substitui o
  "arquivo misturado entre as aulas pela ordem do nome" e o "pasta só de arquivos entre as irmãs".

### Regras dos arquivos (`descricoesDasAulas` e montagem)
1. **Ligado à aula:** documento (.txt, .md, .pdf, .doc, .docx) que cita a aula — mesmo nome, nome
   sem "Descrição", ou o mesmo "Aula N" (agora para **todos** esses tipos, não só txt/md) — no mesmo
   nível, numa pasta com nome de materiais (`/materia(l|is)|apoio|anexos/i`, decisão minha) ao
   lado, ou numa pasta de materiais na raiz do curso. O primeiro (texto antes de PDF/doc) vira a
   descrição e sai da lista; os demais ligados à mesma aula aparecem **logo abaixo dela**, como
   anexos.
2. **Com o nome do módulo** ("MÓDULO X.pdf") e **sem ligação no mesmo nível** ("links.pdf"):
   aparecem no fim da pasta, abaixo das aulas, com o estilo de sempre.
3. **Pasta só com arquivos** ("Arquivos gerais"): aparece como módulo, no fim.
4. Pasta de materiais cujos arquivos foram todos ligados some; se sobrar algum, vale a regra 3.
- A escolha manual de descrição (`descricao_rel`) continua vencendo qualquer palpite.

### Mapeamento (só Telegram; `MapearCurso.tsx`, `routes/mapa.ts`)
- `mapa_pendente=1` só no import do Telegram (`routes/telegram.ts`); sai de `routes/courses.ts`
  (pasta) e `routes/drive.ts`. O menu ⋯ mostra "Organizar…" só para `source='telegram'`; a rota
  recusa os outros (400).
- A tela ganha **submódulo**: cada módulo tem "+ Submódulo", com recuo por nível; arrastar aula
  vale para qualquer nível; desfazer um módulo leva aulas e submódulos para o pai. O pedido manda o
  caminho (`nome: "A/B"`); `nomeDoModulo` saneia cada parte (a barra dentro de um nome vira "-") e
  limita a profundidade (decisão minha: 5 níveis).
- `gravarOrdem` ordena pelos caminhos na ordem do pedido (pai antes dos filhos).
- `AulasNovas.tsx` lista os módulos por caminho ("A › B").
- `partesNoCurso`/`partesDaAulaMapeada`: cada nível vira `NN - Nome/`, numerado entre irmãos.

### Guia de módulos do Telegram (o "Menu" com hashtags)
Muitos canais têm uma mensagem de texto que é o índice do curso: uma linha de título
("= Módulo 01 - PROSPECÇÃO DE CLIENTES", "Documents") seguida das hashtags das aulas
("#D004 #D005 …"), e cada vídeo traz a sua hashtag na legenda.
- **Achar:** hoje só se leem mensagens com mídia. Passam a ser lidas também as mensagens
  **fixadas** (`InputMessagesFilterPinned`) e as **primeiras 50** do canal/tópico, só as de texto.
  O guia é a que tiver mais hashtags que aparecem nas legendas dos vídeos/arquivos do curso (pelo
  menos 3, decisão minha); empate fica com a mais nova (o menu atualizado).
- **Ler:** cada linha sem hashtag e não vazia abre um módulo (sem o "=", "-", "•" do começo e sem
  emoji solto); as hashtags das linhas seguintes são as aulas dele, nessa ordem. Linhas que não
  são título nem hashtag ("Clique aqui…", "Via @…", "-") não abrem módulo se nenhuma hashtag vier
  depois delas.
- **Usar:** a tela de mapeamento, que já abre ao importar o Telegram, vem **pré-montada** pelo
  guia: módulos na ordem do guia, aulas na ordem das hashtags; o que não está no guia fica em "Fora
  dos módulos". A pessoa confere e salva (ou ajusta). Sem guia, abre como hoje.
- **Título:** a hashtag sai do título da aula quando sobra texto ("#D004 Como achar clientes" →
  "Como achar clientes"); se a legenda for só a hashtag, o título vem do nome do arquivo e, na
  falta, fica a hashtag.
- **Aulas novas** num curso mapeado: o popup `AulasNovas.tsx` já vem com o módulo que o guia
  (relido no re-escaneio) indica para a hashtag dela.
- Rota nova não é necessária: o guia vai junto no detalhe do curso enquanto `mapa_pendente=1`
  (ou guardado em `settings` por curso, a decidir no plano).

### Conserto dos cursos já estragados (migração v17)
- Cursos `source IN ('local','drive')` com aula `mapeada=1`: `mapeada=0`, `mapa_pendente=0`;
  módulo, ordem e título não editado são recalculados pelo `deriveCourse` a partir dos `rel_path`
  (ao abrir, depois do `openDb`, porque o derive é TypeScript). `titulo_editado` e `descricao_rel`
  ficam. Os gatilhos da nuvem sobem a mudança.
- Drive com o "Baixar" já reorganizado: `reorganizarBaixados` leva os arquivos de volta para a
  estrutura das pastas (mesma rotina do mapeamento, com os downloads do curso pausados).

## Fica para quem constrói
- Nome exato da regex de "pasta de materiais" e o limite de profundidade (marcados acima).
- Layout visual do submódulo na tela de mapeamento, seguindo `docs/design.md`.
- Atualizar o AGENTS.md (mapeamento só no Telegram, árvore, regras dos arquivos).
