# Cache de aulas, download offline e cache de capas

Data: 2026-10-31 (revisada em 2026-11-02: abordagem híbrida com cache automático)

## Objetivo

Quem assiste um curso do Drive ou do Telegram abre a aula sem esperar. O app traz a aula aberta e
as próximas para um cache local com limite de tamanho. O que já foi carregado não carrega de novo e,
quando falta espaço, o próprio app limpa o que for mais antigo. O download offline continua
permanente e só acontece quando a pessoa pede ("Baixar"). Curso local não passa por nada disso.

As capas aparecem de forma confiável, inclusive quando a origem não entrega miniatura, sem consumir
rede à toa nem atrapalhar a aula.

## Situação atual

- `GET /api/lessons/:id` chama `baixador.pedirAula`, que baixa a aula aberta e as 2 seguintes para a
  pasta de armazenamento, de forma permanente, como se a pessoa tivesse clicado em "Baixar".
- A aula não baixada aparece cinza.
- A rota de capa espera a rede quando a capa não está no disco. Falhas são engolidas em silêncio e
  não ficam registradas, então cada tela pede de novo à origem.
- O curso "Escalada ECOM" (Drive) tem 0 capas em 448 aulas. A causa ainda é desconhecida: o registro
  de falhas desta mudança passa a mostrá-la.

## Decisões

- A regra vale para todo curso remoto: próprio Drive, pasta compartilhada e Telegram. Não há detecção
  de dono.
- Cache automático e download offline são coisas separadas:
  - o cache é do app, tem limite e se limpa sozinho;
  - o download é da pessoa e nunca sai sozinho.
- O princípio "nada é apagado sozinho" passa a valer só para downloads. O cache é a exceção
  declarada.
- A aula sem miniatura na origem ganha capa gerada pelo ffmpeg a partir do stream, sob demanda.
- Cache de aulas e capas não vai para a nuvem.

## Parte 1: cache de aulas e download offline

### Armazenamento do cache

Os arquivos ficam em `DATA_DIR/cache/<lessonId>.<ext>`, com `config.cacheDir` criado em `index.ts`
como os outros diretórios. O cache fica fora da pasta de armazenamento e sem nome real, porque é do
app e não da pessoa.

Tabela local, sem gatilhos da nuvem (schema v14):

```sql
CREATE TABLE cache_aulas (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  arquivo TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  convertido INTEGER NOT NULL DEFAULT 0,
  usado_em INTEGER NOT NULL -- ms desde 1970
);
```

Módulo novo `server/src/cache-aulas.ts`, com tudo o que toca a pasta e a tabela:

- `arquivoEmCache(db, lessonId)`: devolve `{ arquivo, convertido } | null`. A linha cujo arquivo
  sumiu do disco é apagada e o retorno é `null`.
- `registrarEmCache(db, lessonId, arquivo, convertido)`
- `tocarCache(db, lessonId)`: atualiza `usado_em`.
- `limiteDoCache(db)` e `definirLimiteDoCache(db, bytes)`: chave `cache.limite` em `settings`. O
  padrão é 10 GB, e o valor é aceito entre 2 e 100 GB.
- `usoDoCache(db)`: devolve `{ bytes, limite }`.
- `liberarCache(db, protegidas: Set<string>)`: aplica o limite.
- `promoverDoCache(db, config, item)`: move o arquivo para a pasta de armazenamento.
- `apagarCacheDoCurso(db, courseId)` e `limparCache(db)`
- `varrerCache(db, config)`: limpeza ao abrir.

### Janela automática

- `GET /api/lessons/:id` continua chamando `pedirAula` para aulas do Drive e do Telegram.
- `pedirAula` mantém a seleção atual: a aula aberta e as `JANELA` (2) próximas não concluídas. Ele
  pula aulas baixadas (`arquivoBaixado`) e aulas em cache (`arquivoEmCache`). A prioridade não muda:
  interrompe o arquivo em andamento, o `.part` fica e o download interrompido volta depois.
- `ItemBaixavel` ganha `destino: 'cache' | 'armazenamento'`. Os itens da janela automática levam
  `'cache'`. `baixarAula` ("Baixar" da aula) e `baixarCurso` levam `'armazenamento'`.
- Gravação de um item `'cache'`:
  - O arquivo vai para `cacheDir/<lessonId>.<ext>`, retomando um `.part` com a mesma função de
    download atual (`BaixarArquivo`).
  - Antes de começar, se o tamanho da aula passa do limite do cache, o item é pulado e a aula toca
    pela rede.
  - A folga de 2 GB no disco vale como hoje.
  - Ao terminar, se a aula não toca nesta máquina, a conversão (`prepararParaTocar`) roda e o `.mp4`
    convertido toma o lugar do original no cache, com `convertido = 1`.
  - Depois disso: `registrarEmCache`, seguido de `liberarCache(db, protegidas)`. As protegidas são as
    aulas da janela atual mais a última aula pedida.
- A pasta conectada ("Conectar a uma pasta") nunca recebe arquivo de cache.
- O pedido de uma aula que já está na janela como `'cache'` por "Baixar" troca o destino dela para
  `'armazenamento'`. A troca vale antes de começar ou no próximo arquivo; o que já está sendo gravado
  termina no cache e é promovido.
- O comentário de cabeçalho de `drive/baixar.ts` passa a descrever:
  - a janela automática grava no cache;
  - os pedidos explícitos gravam na pasta de armazenamento.

### Limite (`liberarCache`)

Enquanto a soma de `bytes` passar do limite, o app apaga o arquivo e a linha, nesta ordem:

1. aulas concluídas (`progress.completed = 1`), da usada há mais tempo para a mais recente;
2. demais aulas, também pelo `usado_em` mais antigo.

As protegidas nunca saem. Se só restarem protegidas, o app para, mesmo acima do limite.
`liberarCache` também roda quando o limite muda.

### Stream

`GET /api/lessons/:id/stream` de aula remota segue esta ordem:

1. Arquivo baixado: comportamento atual.
2. Arquivo em cache: `servirArquivo`, com `video/mp4` quando convertido e, senão, o tipo do
   container. Chama `tocarCache`.
3. Origem: comportamento atual.

`POST /api/lessons/:id/verify-playback` e `semArquivo` (`routes/convert.ts`) consideram o arquivo em
cache como arquivo presente, do mesmo jeito que o baixado.

### "Baixar" com a aula em cache

Ao processar um item `'armazenamento'` cuja aula está em cache, o app chama `promoverDoCache`:

- Move o arquivo para `destinoDe(...)` com `renameSync`. Entre volumes diferentes, faz cópia e depois
  apaga a origem.
- Chama `registrarBaixado` com o mesmo `convertido` e apaga a linha do cache.
- Na pasta conectada, segue a regra de lá: arquivo da pessoa com o mesmo nome e outro tamanho faz o
  destino virar "Nome (2)", e o convertido continua indo para `DATA_DIR/converted` (`saidaDaConversao`).

Nenhum byte é baixado de novo. Se a mudança falhar, o item é baixado da origem como hoje.

### Configurações e rotas

- `GET /api/armazenamento` passa a incluir `cache: { bytes, limite }`.
- `PUT /api/armazenamento/cache` recebe `{ limite: number }` em bytes e chama `definirLimiteDoCache`
  seguido de `liberarCache`. Fora do intervalo, responde 400.
- `DELETE /api/armazenamento/cache` chama `limparCache` e espera parar o arquivo de cache que estiver
  sendo gravado.
- `DELETE /api/armazenamento` ("Limpar tudo") continua só com os downloads.
- `Settings.tsx`, seção Armazenamento: linha "Cache de aulas: X de Y", seletor de limite
  (2, 5, 10, 20, 50 e 100 GB) e botão "Limpar cache". O texto explica que o cache guarda as aulas
  abertas e as próximas para abrir sem esperar e que o app apaga o mais antigo sozinho.

### Limpeza

- Excluir o curso (`DELETE /api/courses/:id`) chama `apagarCacheDoCurso` antes do `DELETE`, depois de
  `cancelar` e `soltar`.
- `varrerCache`, uma vez ao abrir e só em `index.ts`, junto da retomada de downloads, apaga:
  - arquivos de `cacheDir` sem linha na tabela, o que cobre curso apagado pela sincronização e troca
    de conta;
  - `.part` cuja aula não está na janela atual;
  - linhas cujo arquivo sumiu.
- Os arquivos que o download automático antigo deixou na pasta de armazenamento continuam
  registrados em `baixados` e permanentes, porque não se distinguem do "Baixar".

### Interface das aulas

- `LessonGrid.tsx` e `Course.tsx`: `baixada === false` deixa de aplicar cinza, opacidade ou texto
  apagado, e o título "Não baixada" sai.
- A aula com `baixada === true` ganha um ícone discreto com o título "Disponível offline". Aula em
  cache não ganha marca.
- O visual de `missing` não muda.
- O texto da tela de formato não tocável (`Lesson.tsx`, `semArquivo`) continua dizendo que o app está
  trazendo a aula e converte sozinho, porque a janela automática garante isso.

## Parte 2: cache de capas

### Rota

`GET /api/lessons/:id/thumb` e `GET /api/courses/:id/cover` nunca esperam rede nem ffmpeg:

1. Capa no disco: responde com o arquivo.
2. Sem capa: enfileira, se o estado permitir, e responde 404 na hora.

Isso importa porque a webview abre poucas conexões por host: capas presas na rede poderiam travar a
API e o vídeo.

`getOrCreateLessonThumb` se divide em duas funções:

- `capaNoDisco(db, config, lessonId)`: síncrona, só olha o disco.
- `gerarCapa(...)`: faz o trabalho e é chamada só pela fila.

O curso local passa pela mesma fila com o ffmpeg sobre o arquivo do disco, sem etapa de origem.
`setCourseCover` não muda.

### Fila (`server/src/media/fila-capas.ts`)

Interface:

```ts
interface FilaCapas {
  pedir(lessonId: string): void;
  videoRemotoTocando(): void;
}
```

- A ordem é LIFO: a capa pedida por último sai primeiro, para priorizar o que está na tela.
- Um pedido por aula. Repetir uma aula que já está na fila só a traz para o topo.
- A fila guarda no máximo 500 pedidos. Passando disso, descarta os mais antigos, que voltam quando a
  tela pedir de novo.
- Limites simultâneos de rede: 3 no Drive e 1 no Telegram.
- A estrutura é criada em `buildApp` e passada às rotas.

Etapas de cada aula:

1. **Arquivo local:** aula baixada, aula em cache ou curso local. O ffmpeg extrai o quadro do arquivo
   do disco, sem rede. Sem ffmpeg, segue para a etapa 2 se a aula for remota.
2. **Origem:** Drive com `getArquivo` e `thumbnailLink`; Telegram com `miniatura`. O tratamento do
   host do Google não muda.
3. **ffmpeg pelo stream:** só se a origem não trouxer capa e `hasFfmpeg()` for verdadeiro. Extrai um
   quadro da URL `http://127.0.0.1:<porta>/api/lessons/:id/stream`, no tempo de
   `pickFrameTimestamp`, com limite de 30 s. O processo é morto ao estourar. Uma extração por vez, em
   todas as origens remotas.
4. **Sucesso:** grava com `gravarCapaAtomico`, atualiza `thumb_path` e apaga a linha de `capas_estado`.
5. **Falha:** registra em `capas_estado`.

`extractFrame` ganha um limite de tempo opcional e passa a aceitar URL. A fila recebe a porta real
depois de `escutarComFallback`, porque a 7777 pode estar ocupada. Sem porta, a etapa 3 é pulada. A
requisição do ffmpeg vem de localhost, sem `Origin`, e passa pela guarda normalmente.

A rota de stream remoto chama `videoRemotoTocando()` a cada requisição. Essa chamada só grava a hora
atual, e as requisições internas do ffmpeg, marcadas com um cabeçalho, não contam. Enquanto houver
uma chamada nos últimos 30 s, a etapa 3 espera. As outras etapas continuam: a 1 não usa rede e a 2 só
pede imagens pequenas.

### Falhas (`capas_estado`, schema v14)

Tabela só local, sem gatilhos da nuvem:

```sql
CREATE TABLE capas_estado (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  tentativas INTEGER NOT NULL,
  proxima_em INTEGER NOT NULL, -- ms desde 1970
  motivo TEXT NOT NULL
);
```

| Motivo | Quando | Próxima tentativa |
| --- | --- | --- |
| `rede` | Falha de conexão, timeout, sem sessão | 5 min, sem contar tentativa |
| `sem-capa` | Origem e ffmpeg responderam, sem imagem | 1 h, 6 h, 24 h, depois 7 dias |
| `sem-ffmpeg` | Origem sem capa e ffmpeg ausente | Na próxima abertura em que `hasFfmpeg()` for verdadeiro |

- `pedir` ignora a aula enquanto `proxima_em` estiver no futuro.
- Quando a aula entra no cache ou é baixada, a linha dela é apagada, porque agora há arquivo local.
- Ao abrir o app, se `hasFfmpeg()` for verdadeiro, as linhas `sem-ffmpeg` são apagadas.
- Re-escanear com `mtime` novo apaga a linha da aula, porque o arquivo mudou.

### Importação

`baixarCapasFaltando` (Drive) e `baixarCapas` (Telegram) continuam em lote com o que a origem
oferece. Elas passam a pular aulas com `proxima_em` futuro e a registrar `rede` em caso de falha.
Aula sem miniatura na listagem não é registrada aqui: ela vai para a fila quando aparecer na tela.

### Interface

Componente novo `web/src/components/CapaAula.tsx`, usado em `LessonGrid`, `PlaylistSidebar` e
`Course`, com a mesma aparência atual.

- Quando a imagem falha, fica oculta e tenta de novo depois de 5, 15 e 45 s, trocando um parâmetro da
  URL. Depois disso para.
- Ao mudar de aula, as tentativas recomeçam.
- O timer é limpo ao desmontar.
- As capas de curso em `Library` e `Course` usam a mesma lógica, com a URL recebida por propriedade.
- `Lesson.tsx:123`, a arte da sessão de mídia, continua com a URL direta.

### Limpeza

Uma vez ao abrir, junto de `varrerCache`, a varredura de `thumbsDir` remove:

- `*.tmp`;
- `<lessonId>-<mtime>.jpg` de aula inexistente;
- `<lessonId>-<mtime>.jpg` com `mtime` diferente do atual.

Ela só considera nomes nesse formato exato. `course-*` e `documento-*` nunca entram.

## Erros

- Capa é enfeite: nenhuma falha da fila chega à interface além do placeholder.
- Sem ffmpeg, a aula remota sem miniatura fica no placeholder.
- Falha ao gravar no cache segue as regras da fila atual:
  - rede tenta de novo;
  - sem espaço, a aula toca pela rede e a janela para com o erro em `janela(courseId)`, como hoje.
- `PUT /api/armazenamento/cache` fora do intervalo responde 400, e a interface mantém o valor
  anterior.

## Documentação

Atualizar em `AGENTS.md`:

- downloads: janela automática para o cache, pedidos explícitos para o armazenamento, e o cache como
  exceção ao "nada é apagado sozinho";
- `DATA_DIR`, que passa a ter `cache/`;
- a linha de `media/`, com a fila de capas;
- o modelo de dados, com `cache_aulas` e `capas_estado`.

O cabeçalho de `armazenamento.ts`, que diz que esta é "a única cópia que o app faz", passa a citar o
cache.

## Verificação

O projeto não tem suíte de testes. A verificação é:

1. `pnpm build`.
2. Script com `pnpm exec tsx`, usando banco temporário, `DATA_DIR` próprio e `SUPABASE_URL` apontando
   para `http://127.0.0.1:9`. Nunca a sessão real de Telegram ou conta. A origem é falsa, usando
   `BaixarArquivo` e `ClienteTelegram` falsos. Cobre:
   - janela gravando no cache;
   - ordem do stream (baixado, cache, origem);
   - `liberarCache`, com concluídas primeiro, LRU e protegidas;
   - aula maior que o limite;
   - promoção ao "Baixar";
   - varreduras de limpeza;
   - falha, espera e nova tentativa de capa;
   - ordem LIFO e pedidos repetidos da fila de capas;
   - pausa do ffmpeg;
   - extração de quadro de um MP4 local servido por um servidor falso com Range.
3. Abrir uma aula remota no app e conferir que ela e as 2 próximas vão para `~/.astroflix/cache`, e
   não para a pasta de downloads.
4. Gerar o `.dmg` 2.1.999 com o Node 22 do fnm.

## Fora de escopo

- Gravar no cache os bytes que passam pelo stream. O cache baixa o arquivo inteiro em paralelo.
- Sincronizar cache ou capas pela nuvem.
- Pré-gerar capas na importação.
- Detectar dono da pasta.
- Mudar o painel de downloads.
- Distinguir os downloads automáticos antigos dos explícitos.
