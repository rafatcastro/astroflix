# Download só quando pedido e cache de capas

Data: 2026-10-31

## Objetivo

Quem importa um curso do Drive ou do Telegram assiste direto da origem. O download offline existe,
mas só acontece quando a pessoa pede. As capas passam a aparecer de forma confiável, inclusive
quando a origem não entrega miniatura, sem consumir rede à toa nem atrapalhar a aula.

## Situação atual

- `GET /api/lessons/:id` chama `baixador.pedirAula`, que baixa a aula aberta e as 2 seguintes.
- Aula remota em formato que não toca direto (MKV, HEVC, TS) depende desse download para ser
  convertida.
- A aula não baixada aparece cinza, porque baixar era o caminho normal.
- A rota de capa espera a rede quando a capa não está no disco. Falhas são engolidas em silêncio e
  não ficam registradas, então cada tela pede de novo à origem.
- O curso "Escalada ECOM" (Drive) tem 0 capas em 448 aulas. A causa ainda é desconhecida: o registro
  de falhas desta mudança passa a mostrá-la.

## Decisões

- A regra vale para todo curso remoto, seja do próprio Drive, de pasta compartilhada ou do Telegram.
  Não há detecção de dono.
- Se o Google bloquear uma pasta por cota, aparece o erro atual. O download passa pela mesma cota,
  então não é alternativa automática.
- A aula sem miniatura na origem ganha capa gerada pelo ffmpeg a partir do stream, sob demanda.
- Capas não vão para a nuvem. Outra máquina gera as suas sob demanda.

## Parte 1: download só quando pedido

### Servidor

- `GET /api/lessons/:id` deixa de chamar `pedirAula`.
- `pedirAula` continua existindo, mas baixa só a aula pedida. A constante `JANELA` e a seleção das
  próximas aulas saem. Ela mantém a prioridade: interrompe o arquivo em andamento, o `.part` fica e o
  download interrompido volta depois.
- Rota nova: `POST /api/lessons/:id/baixar-para-assistir`, que chama `pedirAula`. Mesmas respostas de
  `POST /api/lessons/:id/baixar`: 202, 404 (`not_found`, aula não remota) e 503 (`sem-conexao`).
- `POST /api/lessons/:id/baixar` não muda: entra na fila sem interromper nada.
- O comentário de cabeçalho de `drive/baixar.ts` passa a descrever os dois pedidos reais: aula pedida
  e curso inteiro.

Não mudam: "Baixar" do curso e da aula, painel de downloads, retomada ao abrir, "Conectar a uma
pasta", "Remover download", "Limpar tudo", preferência do stream pelo arquivo baixado e os arquivos
que já estão no disco.

### Interface

- Tela de formato não tocável (`Lesson.tsx`), com `semArquivo`: o texto "já está baixando" sai. A
  tela explica que o formato não toca direto da origem e mostra o botão **"Baixar para assistir"**.
- Depois do clique, a tela diz que está baixando e que a aula começa sozinha quando chegar. A
  verificação a cada 4 s só começa depois do clique. O início automático continua igual.
- Reabrir a aula com o download em andamento mostra o botão de novo. Clicar é seguro: `pedirAula`
  não duplica o arquivo em andamento.
- `LessonGrid.tsx` e `Course.tsx`: `baixada === false` deixa de aplicar cinza,
  opacidade ou texto apagado, e o título "Não baixada" sai. A aula com `baixada === true` ganha um
  ícone discreto com o título "Disponível offline". O visual de `missing` não muda.

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

1. **Origem:** Drive com `getArquivo` e `thumbnailLink`; Telegram com `miniatura`. O tratamento do
   host do Google não muda.
2. **ffmpeg:** só se a origem não trouxer capa e `hasFfmpeg()` for verdadeiro. Extrai um quadro da
   URL `http://127.0.0.1:<porta>/api/lessons/:id/stream`, no tempo de `pickFrameTimestamp`, com limite
   de 30 s. O processo é morto ao estourar. Uma extração por vez, em todas as origens remotas.
3. **Sucesso:** grava com `gravarCapaAtomico`, atualiza `thumb_path` e apaga a linha de `capas_estado`.
4. **Falha:** registra em `capas_estado`.

`extractFrame` ganha um limite de tempo opcional e passa a aceitar URL. A fila recebe a porta real
depois de `escutarComFallback`, porque a 7777 pode estar ocupada. Sem porta, a etapa do ffmpeg é
pulada para as aulas remotas. A requisição do ffmpeg vem de localhost, sem `Origin`, e passa pela
guarda normalmente.

A rota de stream remoto chama `videoRemotoTocando()` a cada requisição. Essa chamada só grava a hora
atual, e as requisições internas do ffmpeg, marcadas com um cabeçalho, não contam. Enquanto houver
uma chamada nos últimos 30 s, a etapa do ffmpeg espera. A etapa de origem continua, porque só pede
imagens pequenas.

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

`pedir` ignora a aula enquanto `proxima_em` estiver no futuro. Ao abrir o app, se `hasFfmpeg()` for
verdadeiro, as linhas `sem-ffmpeg` são apagadas. Re-escanear com `mtime` novo apaga a linha da aula,
porque o arquivo mudou.

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

Uma vez ao abrir, junto da retomada de downloads (só em `index.ts`), a varredura de `thumbsDir`
remove:

- `*.tmp`;
- `<lessonId>-<mtime>.jpg` de aula inexistente;
- `<lessonId>-<mtime>.jpg` com `mtime` diferente do atual.

Ela só considera nomes nesse formato exato. `course-*` e `documento-*` nunca entram.

## Erros

- Capa é enfeite: nenhuma falha da fila chega à interface além do placeholder.
- Sem ffmpeg, a aula sem miniatura fica no placeholder.
- Se o clique em "Baixar para assistir" falhar (503), a tela mostra o aviso e mantém o botão.
- Erros do download aparecem como já aparecem hoje.

## Documentação

Atualizar em `AGENTS.md` a descrição dos downloads, a linha de `lessons`, o `media/` e o modelo de
dados.

## Verificação

O projeto não tem suíte de testes. A verificação é:

1. `pnpm build`.
2. Script com `pnpm exec tsx`, usando banco temporário, `DATA_DIR` próprio e `SUPABASE_URL` apontando
   para `http://127.0.0.1:9`. Nunca a sessão real de Telegram ou conta. Cobre:
   - falha, espera e nova tentativa;
   - ordem LIFO e pedidos repetidos;
   - pausa do ffmpeg;
   - extração de quadro de um MP4 local servido por um servidor falso com Range;
   - varredura de limpeza.
3. Abrir a aula remota e conferir que nada entra na fila de downloads.
4. Gerar o `.dmg` 2.1.999 com o Node 22 do fnm.

## Fora de escopo

- Sincronizar capas pela nuvem.
- Pré-gerar capas na importação.
- Detectar dono da pasta.
- Mudar o stream remoto ou o painel de downloads.
- Baixar para offline a partir da tela da aula, além do caso de formato não tocável.
