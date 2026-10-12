# Curso a partir do Google Drive — design

**Data:** 2026-10-12

## Problema

Muitos cursos chegam como um link de pasta do Google Drive. Hoje, para assistir no Learnflix, é
preciso baixar tudo antes (gigabytes, horas) e só então adicionar a pasta. Quem tem pouco disco ou
só quer começar a assistir fica de fora.

Objetivo: colar o link de uma pasta do Drive e o curso aparecer na estante como qualquer outro —
aulas, módulos, capas e duração — com o vídeo carregando **sob demanda** ao abrir a aula, sem baixar
o curso inteiro, e com o progresso tão confiável quanto o dos cursos locais.

## Decisões

| Decisão | Escolha |
|---|---|
| Como a aula toca | O servidor local repassa o vídeo do Drive para o player do Learnflix (HTTP Range) |
| Player embutido do Google | Não — o iframe é de outra origem e o app não consegue ler a posição, o que quebra o progresso |
| Acesso | Tenta como pasta pública (chave de API); se não tiver acesso, pede autorização com o popup do Google |
| Credenciais | App OAuth do mantenedor embutido como padrão, trocável por variável de ambiente ou nas Configurações |
| Unidade importada | Uma pasta do Drive = um curso; subpastas viram módulos |
| Materiais | Repassados sob demanda, como os vídeos |
| Download/cache offline | Fora desta etapa |
| Google Docs/Planilhas/Apresentações | Ignorados (não viram aula nem material) |

## Princípios preservados

- **O progresso não se prende a caminho absoluto nem a ID do Drive.** A aula continua identificada
  pelo `rel_path` dentro do curso, montado com os nomes das pastas e arquivos no Drive. Re-escanear
  depois de o dono reorganizar IDs (re-upload do mesmo arquivo) preserva o histórico.
- **Rede é opcional.** Quem nunca cola um link do Drive não configura nada, não vê login e não faz
  nenhuma requisição externa. Cursos locais não mudam de comportamento.
- **Nenhum teste toca a rede.** Toda chamada ao Google passa por um `fetch` injetável.

## Arquitetura

### `server/src/drive/` — um arquivo por responsabilidade

- **`link.ts`** (puro): extrai o ID da pasta e o `resourcekey` opcional de qualquer formato de link:
  `drive.google.com/drive/folders/<id>`, `.../drive/u/0/folders/<id>`, `?id=<id>`, com ou sem
  `?usp=sharing`. Link que não é de pasta (arquivo único, Docs) é recusado com mensagem clara.
- **`api.ts`**: cliente mínimo da Drive API v3 sobre `fetch`. Recebe `{ fetch, apiKey, token() }`,
  manda `key=` ou `Authorization: Bearer`, `supportsAllDrives=true` e o cabeçalho
  `X-Goog-Drive-Resource-Keys` quando houver. Repete com espera exponencial em 403 de limite de
  taxa, 429 e 5xx, até 6 tentativas — mesmo espírito do `execute_with_retry` do script de origem.
  Distingue os erros que a interface precisa explicar: `sem-acesso`, `cota-esgotada`,
  `sem-conexao`, `nao-autorizado` (token revogado).
- **`auth.ts`**: OAuth 2.0 para app de computador, com redirecionamento de loopback para
  `http://127.0.0.1:<porta>/api/drive/auth/callback` e PKCE (`S256`). Escopo
  `https://www.googleapis.com/auth/drive.readonly` mais `openid email` para mostrar a conta
  conectada. O `state` é aleatório, guardado em memória por 10 minutos e consumido uma vez. O
  refresh token fica em `settings` (`drive.refresh_token`, `drive.email`); o access token vive só em
  memória e é renovado quando expira.
- **`walk.ts`**: percorre a pasta recursivamente com `files.list` (`q='<id>' in parents and
  trashed=false`, paginando até acabar) e devolve o mesmo formato do `scan/walk.ts` local —
  `{ videos, materials }` com `{ relPath, sizeBytes, mtime }` — acrescido de `remoteId`,
  `thumbnailLink` e `durationSec` (de `videoMediaMetadata.durationMillis`). Atalhos do Drive são
  seguidos uma vez; arquivos nativos do Google (`application/vnd.google-apps.*`, exceto pasta) são
  ignorados. A classificação vídeo/material reaproveita `VIDEO_EXTS` de `scan/derive.ts`.
- **`stream.ts`**: repassa `GET files/<id>?alt=media` com o `Range` recebido e devolve status,
  `Content-Range`, `Content-Length`, `Content-Type` e corpo em fluxo, sem gravar nada em disco.
  Cancela a requisição ao Google quando o navegador fecha a conexão (seek rápido gera muitas).

### Ingestão

`createCourseFromDrive(db, deps, link)` em `scan/` espelha `createCourseFromPath`: lista com
`drive/walk.ts`, passa os vídeos pelo **`deriveCourse` atual sem mudança** (módulos, ordem natural,
títulos limpos) e grava tudo numa transação. O título do curso é o nome da pasta no Drive. As capas
são baixadas do `thumbnailLink` para `thumbs/` durante a ingestão, porque o link expira; a falha de
uma capa não impede o curso de entrar (fica o placeholder).

Re-escanear um curso do Drive roda o mesmo `drive/walk.ts` e passa a lista para o `planReconcile`
puro de `scan/reconcile.ts`, que já separa o plano da leitura do disco: aula nova entra, aula que
sumiu fica `missing`, progresso de quem continua é preservado. Só a etapa que lê os arquivos
(hoje `walkCourseDir`, síncrona) ganha a variante assíncrona do Drive; a aplicação do plano é a
mesma.

### Banco — migração v2

Bloco novo `if (version < 2)` em `db/index.ts`; `SCHEMA_V1` não muda.

```sql
ALTER TABLE courses   ADD COLUMN source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','drive'));
ALTER TABLE courses   ADD COLUMN drive_folder_id TEXT;
ALTER TABLE courses   ADD COLUMN drive_resource_key TEXT;
ALTER TABLE lessons   ADD COLUMN remote_id TEXT;
ALTER TABLE materials ADD COLUMN remote_id TEXT;
```

No curso do Drive, `root_path` guarda o link original: serve para exibir e para reconhecer o mesmo
curso num backup, e nunca é aberto no disco.

### Quem lê `root_path` hoje passa a olhar `source`

| Ponto | Curso do Drive |
|---|---|
| `routes/stream.ts` | Repassa via `drive/stream.ts` |
| `routes/materials.ts` | Repassa via `drive/stream.ts`, com `Content-Disposition` para "Baixar" |
| `media/thumbs.ts`, `routes/thumbs.ts` | Usa a capa baixada na ingestão; não chama ffmpeg |
| Duração | Vem do Drive na ingestão |
| `scan/reconcile.ts` (re-escanear) | Lista o Drive em vez do disco |
| `scan/repoint-prefix.ts`, re-apontar | Desativado (409 com mensagem) |
| `routes/convert.ts` | Desativado (409); formato não tocável mostra o aviso sem o botão |
| `routes/fs.ts`, `isWithinRoots` | Não se aplica: o curso não tem caminho no disco |
| `backup/` | Ver abaixo |

### Backup

O export inclui `source` e `driveFolderId`/`driveResourceKey` quando o curso é do Drive (campos
opcionais; backups antigos continuam válidos). No import, um curso do Drive que já existe aqui é
reconhecido pelo `root_path` (o link) ou pela impressão digital das aulas, como hoje, e o merge de
progresso é o mesmo. Um curso do Drive que **não** existe aqui não é recriado pela importação:
aparece no resumo como "curso do Google Drive — adicione o link e importe de novo para trazer o
progresso".

## Rotas novas (`routes/drive.ts`, registrado no `// [ROUTES]`)

| Rota | Faz |
|---|---|
| `POST /api/drive/courses` `{ link }` | Cria o curso. Respostas: `201 { id }`; `401 { precisaAutorizar: true, url }`; `403 { erro: 'sem-acesso' }`; `400` link inválido; `502`/`503` erros do Google |
| `GET /api/drive/auth/callback` | Recebe `code`+`state`, troca pelo token, grava e devolve uma página mínima que faz `postMessage` para a janela que abriu o popup e se fecha |
| `GET /api/drive/status` | `{ conectado, email }` — o token nunca sai do servidor |
| `DELETE /api/drive/auth` | Desconecta: revoga no Google (melhor esforço) e apaga de `settings` |

O callback é GET, então a `guarda.ts` não exige `Origin` nele; a proteção é o `state` de uso único
mais o PKCE. As demais rotas herdam a guarda.

## Fluxo na interface

1. Na estante, **Adicionar curso** ganha a opção **Do Google Drive**, que abre um campo para colar o
   link.
2. A interface chama `POST /api/drive/courses`.
   - `201`: navega para o curso.
   - `401 precisaAutorizar`: abre `url` com `window.open` (popup). Ao receber o `postMessage` de
     mesma origem, repete o pedido sozinha.
   - `403 sem-acesso`: "Sua conta Google não tem acesso a esta pasta. Peça acesso ao dono do link."
3. Uma pasta grande leva alguns segundos para listar: o botão mostra estado de carregando e o campo
   fica bloqueado até a resposta.
4. A aula usa `/api/lessons/:id/stream` como sempre; o player não sabe de onde vem o vídeo.
5. Erros no player, com texto claro e nunca tela preta: sem conexão; cota de download do Google
   esgotada (pasta muito compartilhada — o Google libera em algumas horas); autorização revogada
   (botão **Autorizar de novo**).
6. Configurações ganha a seção **Google Drive**: "Conectado como fulano@gmail.com · Desconectar", e
   campos opcionais de client ID, client secret e chave de API para usar um app próprio.

O curso do Drive tem um selo discreto "Google Drive" na página do curso, e o menu ⋯ esconde
"Re-apontar pasta…".

## Credenciais

`config.ts` ganha `google: { clientId, clientSecret, apiKey }`. Ordem de precedência: valor salvo
nas Configurações → variável de ambiente (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_API_KEY`) → padrão embutido do app do mantenedor.

O client de app de computador não é confidencial segundo o Google, e a chave de API é restrita à
Drive API no console; ambos podem ir no código. Enquanto o app OAuth não passar pela verificação do
Google, quem autoriza vê o aviso de "app não verificado" e há um teto de 100 usuários — o campo de
app próprio nas Configurações é a saída para quem esbarrar nisso.

Limitação conhecida: o redirecionamento de loopback só funciona autorizando **na máquina onde o
servidor roda**. Quem acessa por `BIND=0.0.0.0` de outro aparelho autoriza uma vez na máquina
principal.

## Testes

TDD, sem rede (fake `fetch` injetado):

- `drive/link.test.ts`: todos os formatos de link, `resourcekey`, links recusados.
- `drive/api.test.ts`: retry com espera em 429/5xx, mapeamento dos erros, chave vs. token.
- `drive/walk.test.ts`: paginação, recursão, `relPath` com nomes de pasta, atalhos, nativos do
  Google ignorados, vídeos vs. materiais.
- `drive/stream.test.ts`: repasse de `Range` → `206` e cabeçalhos; cancelamento quando o cliente
  fecha.
- `drive/auth.test.ts`: URL com PKCE e `state`; callback recusa `state` desconhecido ou reusado;
  renovação do access token.
- `db` migração v2: banco v1 com dados sobe para v2 sem perder nada; `source` padrão `'local'`.
- `routes/drive.test.ts` com `app.inject`: os quatro desfechos do `POST /api/drive/courses`.
- `routes/stream.test.ts` e `routes/materials.test.ts`: um caso de curso do Drive em cada.
- `backup/`: export/import com curso do Drive presente e ausente.

Checagem manual: um link público real e um privado real, do colar ao seek no meio da aula.

## Fora desta etapa

- Cache e download sob demanda (baixar a próxima aula, apagar as antigas acima de um limite).
- Baixar o curso inteiro para uma pasta local.
- Importar uma pasta do Drive com vários cursos como biblioteca.
- Converter formatos não tocáveis vindos do Drive.
- Sincronização automática; continua valendo **Re-escanear agora**.
