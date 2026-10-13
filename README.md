# Learnflix

Assista aos cursos em vídeo que já estão nas suas pastas, com o progresso guardado direito.

Você aponta uma pasta, ela vira um curso: o Learnflix encontra as aulas, respeita a ordem e os
módulos, gera as capas e lembra exatamente onde você parou em cada aula. Tudo roda na sua máquina —
usando pastas locais, nada é enviado para lugar nenhum, sem conta e sem login.

> Este repositório é um fork do **[Learnflix v2](https://github.com/OnaitsirC-MiromA/learnflix-v2)**,
> criado por [OnaitsirC-MiromA](https://github.com/OnaitsirC-MiromA). Todo o crédito pelo app
> original é desse projeto; aqui ficam as mudanças feitas por cima dele.

**É um programa normal**: baixe o instalador do seu sistema, instale e abra. Não precisa de
terminal, de Node nem de compilar nada — e ele se atualiza sozinho.

![Biblioteca do Learnflix com dezenas de cursos em grade, cada um com capa, número de aulas e percentual concluído](docs/biblioteca.png)

---

## Como instalar

Baixe o instalador na **[página da última versão](https://github.com/rafatcastro/learnflix-v2/releases/latest)**:

| Sistema | Arquivo |
|---|---|
| macOS (Apple Silicon: M1, M2…) | `Learnflix_<versão>_aarch64.dmg` |
| macOS (Intel) | `Learnflix_<versão>_x64.dmg` |
| Windows | `Learnflix_<versão>_x64-setup.exe` (ou o `.msi`) |
| Linux | `Learnflix_<versão>_amd64.AppImage` (ou o `.deb` / `.rpm`) |

Abra o Learnflix como qualquer outro programa — pelo Dock, pelo menu Iniciar ou pelo menu de
aplicativos. Ele abre na própria janela.

![Tela inicial vazia do Learnflix, com os botões para adicionar cursos](docs/tela-inicial.png)

*É isso que aparece na primeira vez: sem cadastro, sem configuração — só apontar onde estão seus cursos.*

<br>

**Para atualizar**, não precisa fazer nada: quando sai uma versão nova, aparece um aviso discreto no
topo da janela — **Atualizar** baixa, instala e reabre o app. Seus cursos e seu progresso não são
tocados: eles moram fora da pasta do programa.

<details>
<summary>O macOS diz que o app "está danificado" ou é de "desenvolvedor não identificado"</summary>

<br>

O Learnflix ainda não tem o certificado pago da Apple, então o Gatekeeper desconfia dele na primeira
vez. Arraste o app para **Aplicativos** e tente abrir; quando o aviso aparecer, vá em **Ajustes do
Sistema → Privacidade e Segurança** e clique em **Abrir mesmo assim**. Se aparecer "está danificado
e não pode ser aberto", rode uma vez no Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Learnflix.app
```

Depois disso ele abre normalmente, inclusive pelo Dock.

</details>

<details>
<summary>O Windows mostrou "o Windows protegeu o computador"</summary>

<br>

É o SmartScreen: ele desconfia de todo instalador novo sem um certificado pago de assinatura.
**Mais informações → Executar assim mesmo**.

</details>

<details>
<summary>Linux: o AppImage não abre</summary>

<br>

Dê permissão de execução (`chmod +x Learnflix_*.AppImage`) e abra. Em Debian/Ubuntu, o `.deb`
instala com `sudo apt install ./Learnflix_*.deb` e põe o app no menu.

</details>

<details>
<summary>Já usava o Learnflix em outro computador</summary>

<br>

Exporte a biblioteca lá (botão **↓** no topo da estante) e importe aqui em
**Configurações → Backup e migração**. Vai tudo junto: cursos, bibliotecas e o progresso de cada
aula. Veja [Backup e migração](#backup-e-migração).

</details>

---

## Adicionando seus cursos

Clique em **Adicionar ▾ → Dos arquivos** e escolha a pasta na janela do próprio sistema (Finder,
Explorer ou o seletor do Linux).

- **Um curso**: se a pasta tem vídeos, ela vira um curso. Cada vídeo vira uma aula, e subpastas
  viram os módulos. Arquivos que não são vídeo (PDFs, slides, exercícios, código) aparecem como
  **materiais**, para abrir ou baixar.
- **Vários de uma vez**: se os vídeos estão só nas subpastas, o app pergunta se a pasta é um curso
  com módulos ou uma pasta com vários cursos. No segundo caso, cada subpasta com vídeos vira um
  curso, e o Learnflix guarda essa pasta: depois basta clicar em **Verificar novos cursos** para
  trazer o que apareceu de novo. Rodar de novo nunca duplica nada.

A ordem das aulas segue o nome dos arquivos, com ordenação numérica de verdade — `aula 2` vem antes
de `aula 10`, e não depois.

**Nada é copiado, movido ou renomeado.** O Learnflix só lê a sua pasta; os arquivos ficam
exatamente onde estão.

![Página de um curso: cartão "Continuar" no topo, a lista de aulas com miniatura e estado de cada uma, e abaixo a seção de materiais adicionais com os PDFs do curso, cada um com os botões Abrir e Baixar](docs/curso.png)

*Dentro do curso: o cartão do topo leva direto ao ponto onde você parou, e os PDFs e anexos que
vieram junto ficam logo abaixo das aulas.*

---

## Cursos do Google Drive

Também dá para assistir a uma pasta que está no Google Drive. Clique em **Adicionar ▾ → Do Google
Drive** (na biblioteca vazia, o botão **Do Google Drive**) e cole o link da pasta.

- **Pasta pública**: abre direto, sem login.
- **Pasta privada**: o app abre a autorização do Google no seu navegador; depois de autorizar, é só
  voltar para o Learnflix. A permissão é só de leitura
  (`drive.readonly`); o Learnflix nunca cria, altera nem apaga nada no seu Drive.
- **O curso vem para o computador**: depois de colar o link, o Learnflix baixa as aulas na ordem do
  curso para a pasta de dados do app e, se algum vídeo estiver num formato que o player não toca,
  já o converte. Cada aula que chega passa a tocar sem internet; as que ainda não chegaram tocam
  direto do Drive enquanto isso. Se o app fechar no meio, o download continua de onde parou na
  próxima vez. Excluir o curso apaga as cópias.

**O Google mostra um aviso na autorização.** O app ainda não foi verificado pelo Google, então
aparece "O Google não verificou este app": clique em **Avançado → Continuar**. Enquanto não for
verificado há também um teto de 100 usuários. Se esbarrar nele, use o seu próprio app do Google Cloud
em **Configurações → Google Drive**.

Quem usa só pastas locais não percebe diferença: nada disso é configurado, pedido ou acessado. Os
detalhes do que o app lê estão na [política de privacidade](PRIVACY.md).

---

## Cursos do Telegram *(em desenvolvimento)*

Grupo ou canal do Telegram com as aulas postadas também vira curso. Clique em **Adicionar ▾ → Do
Telegram** e cole o link (`t.me/…`).

> **Ainda em teste.** Por enquanto a opção só aparece rodando o app pelo código (`pnpm dev`, veja
> [Desenvolvimento](#desenvolvimento)), com o selo **Em desenvolvimento**, até ser validada com
> contas reais. Para experimentar, crie um app em [my.telegram.org](https://my.telegram.org) →
> **API development tools** e cole o `api_id` e o `api_hash` em **Configurações → Telegram → Usar
> um app próprio do Telegram**.

- **Com a sua conta**: na primeira vez, o app mostra um QR code. No celular, abra o Telegram →
  **Configurações → Dispositivos → Conectar dispositivo** e aponte para a tela. A sessão aparece lá
  como "Learnflix", e você pode encerrá-la por ali ou em **Configurações → Telegram**.
- **A ordem é a do grupo**: cada vídeo vira uma aula na ordem em que foi postado, com o título da
  legenda. PDFs e outros arquivos viram materiais; conversa, foto e figurinha ficam de fora.
- **Grupo privado e convite**: vale qualquer grupo em que você já está. Num link de convite
  (`t.me/+…`), o app pergunta antes de entrar no grupo com a sua conta.
- **Nada é baixado**: o vídeo é transmitido na hora, com avançar e voltar funcionando. Contas sem
  Telegram Premium têm download mais lento, e isso é limite do próprio Telegram. As capas são as
  miniaturas que o próprio Telegram guarda, sem precisar do ffmpeg.
- **Fora por enquanto**: tópicos de grupos-fórum (o curso vira uma lista única) e vídeos que são só
  um link externo.

Quem não usa Telegram não vê nada disso: o app não conecta ao Telegram até você colar um link.

---

## Bibliotecas

Cursos soltos viram bagunça rápido. Crie uma **biblioteca** (Programação, Inglês, Faculdade…) e
arraste os cursos para dentro — a tela inicial passa a mostrar cada grupo separado.

Excluir uma biblioteca **não apaga curso nenhum**: os cursos voltam para a lista geral, com todo o
progresso intacto. Biblioteca é organização, não posse.

---

## Capas e durações (ffmpeg)

O app funciona inteiro sem o ffmpeg — mas com ele instalado cada aula ganha uma miniatura e a
duração aparece na lista, o que muda bastante a cara da coisa. Se você pulou essa parte lá em cima,
dá para acrescentar a qualquer momento:

| Sistema | Como instalar |
|---|---|
| macOS | `brew install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` |
| Linux | `sudo apt install ffmpeg` (ou o gerenciador da sua distro) |

Instale, feche e abra o Learnflix de novo e as capas aparecem sozinhas nos cursos que você abrir. Você também
pode escolher outro quadro como capa do curso pelo menu ⋯.

---

## Backup e migração

O botão **↓** no topo da estante baixa um arquivo com tudo o que você construiu: os cursos, as
bibliotecas, a capa que você escolheu e o progresso de cada aula. É um `.json` pequeno — alguns
kilobytes, mesmo com dezenas de cursos — porque **os vídeos não vão junto**, só o que você fez em
cima deles.

Guarde esse arquivo onde quiser. Para trazê-lo de volta, ou levá-lo para outro computador, vá em
**Configurações → Backup e migração → Importar arquivo…**.

**A importação nunca tira nada.** Antes de confirmar, ela mostra o que vai acontecer:

```
Importar esta biblioteca?

  3 cursos novos
  2 já existem aqui — fica o progresso mais avançado dos dois,
    e aula concluída não volta atrás

              Cancelar    Importar
```

Quando a mesma aula aparece dos dois lados, vence sempre quem foi mais longe. Se você assistiu 12
minutos numa máquina e 40 na outra, ficam os 40. Aula concluída não desconclui. Importar um backup
antigo por engano não apaga nada do que você viu depois dele, e importar o mesmo arquivo duas vezes
dá no mesmo que importar uma.

**Mudar de computador funciona mesmo com os caminhos diferentes.** O Learnflix reconhece um curso
pelas aulas que ele tem, não pela pasta onde mora — então um curso que estava em `D:\Cursos\Rust` no
Windows e agora está em `/Volumes/HD/Rust` no Mac é reencontrado sozinho. E se o disco nem estiver
plugado na hora, o curso entra assim mesmo, com todo o progresso: quando você conectar o HD, use
**Re-apontar pasta…** no menu ⋯ do curso.

---

## Seus dados

Todo o progresso mora num único arquivo, **fora da pasta do app**:

```
~/.learnflix/app.db                      macOS e Linux
%LOCALAPPDATA%\Learnflix\app.db          Windows
```

Ficar fora é o que faz **atualizar não custar nada**: a versão nova substitui o programa e nem toca
no banco. Copiar esse arquivo também é um backup válido — mais bruto que o export acima, mas serve.
As miniaturas ficam em `thumbs/`, ao lado, e são regeneradas a qualquer momento.

O progresso não está preso ao caminho da pasta: cada aula é identificada pelo lugar dela *dentro* do
curso. Por isso, se você mover a pasta de um curso para outro disco, é só usar **Re-apontar
pasta…** no menu ⋯ do curso e apontar o novo lugar — as aulas se reencontram e nada do que você já
assistiu se perde.

---

## Atalhos de teclado

Enquanto assiste:

| Tecla | Faz |
|---|---|
| `Espaço` | Play / pausar |
| `→` / `←` | Avança / volta 10 segundos |
| `↑` / `↓` | Volume |
| `F` | Tela cheia |
| `M` | Mudo |
| `N` / `P` | Próxima / aula anterior |
| `?` | Mostra esta lista na tela |
| `Esc` | Sai da tela cheia / volta ao curso |

---

## Quando um vídeo não toca

Alguns cursos baixados trazem arquivos com a extensão errada — um `.mp4` que por dentro é MPEG-TS,
por exemplo. O navegador não toca, e o Learnflix explica o motivo em vez de mostrar uma tela preta.

Quando dá para consertar sem perda de qualidade, aparece o botão **Converter agora (sem perda)**: a
conversão leva segundos, é gravada à parte e **o arquivo original não é tocado**.

Quando o codec em si não toca na janela (H.264 10-bit, ou HEVC no Windows sem a extensão HEVC),
aparece **Converter para assistir**: o Learnflix recodifica a aula para H.264 com o ffmpeg, com uma
barra de andamento. Leva alguns minutos, e o original também não é tocado. No Mac, HEVC toca
direto: o app pergunta ao player o que ele reproduz em vez de supor o pior.

---

## Configuração

**HD externo funciona sem configurar nada.** Por padrão o seletor enxerga todos os discos montados:
as unidades (`C:`, `D:`, `E:`…) no Windows, `/Volumes` no macOS, `/media` e `/mnt` no Linux, mais a
sua pasta de usuário. Plugou o HD com o app já aberto? Ele aparece — não precisa reiniciar.

Você também pode acrescentar pastas-raiz pela tela de **Configurações**.

---

## Desenvolvimento

Monorepo com três workspaces: `server` (Fastify + SQLite), `web` (React + Vite) e `desktop` (a casca
do app, em [Tauri](https://tauri.app)). Precisa de Node 22.5+, pnpm e, para o app desktop, do
[Rust](https://rustup.rs).

```bash
git clone https://github.com/rafatcastro/learnflix-v2 && cd learnflix-v2 && pnpm install
pnpm dev             # a janela do app, com hot reload da interface (Vite) e do servidor
pnpm test            # testes do servidor e da interface
pnpm build           # tipos + interface + dist/learnflix.cjs (o servidor num arquivo só)
pnpm desktop:build   # gera o instalador desta máquina em desktop/src-tauri/target/release/bundle
```

O servidor existe porque a interface (uma página web, dentro da janela) não consegue ler pastas do
disco sozinha: ele lê as pastas (sempre só-leitura), transmite o vídeo por HTTP Range para o seek
funcionar, gera as miniaturas e é dono do banco. A interface conversa com ele por uma API JSON.

Recursos de rede ficam isolados em `server/src/drive/` (Google Drive, OAuth com PKCE e Drive API)
e `server/src/telegram/` (a conta da pessoa via MTProto, com o [GramJS](https://gram.js.org)
carregado só quando alguém cola um link). Os testes injetam clientes falsos, então a suíte inteira
roda sem rede.

O app desktop é uma janela que sobe esse servidor — empacotado num executável único, com o Node
dentro — e carrega a interface dele. No `pnpm dev`, a mesma janela abre o Vite, e o servidor roda
direto do código-fonte.

Cada push na `main` (que não seja só de documentação) vira uma versão: a CI roda os testes, gera os
instaladores (macOS Apple Silicon e Intel, Windows e Linux) numa release em rascunho e só a publica
depois de conferir que as quatro plataformas estão no arquivo que o atualizador consulta. Quem já tem
o app recebe o aviso. O número é automático — o `major.minor` do `package.json` mais o número da
execução da CI —, então ninguém cria tag à mão.

<details>
<summary>Publicando o seu próprio fork</summary>

<br>

1. `pnpm repo seu-usuario/seu-repo` troca o repositório no `package.json`, no README e no
   `tauri.conf.json` (o atualizador procura as versões lá).
2. Gere uma chave de assinatura do atualizador (`pnpm --filter desktop tauri signer generate`),
   ponha a pública no `tauri.conf.json` e a privada no secret `TAURI_SIGNING_PRIVATE_KEY`.
3. Opcionais: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_API_KEY` para o Drive;
   `TELEGRAM_API_ID` e `TELEGRAM_API_HASH` para o Telegram. Sem eles, o app funciona igual e a
   pessoa pode usar credenciais próprias em Configurações.
4. Em forks, o GitHub desliga os workflows: ative em **Actions** antes do primeiro push.

Localmente, as mesmas credenciais podem ficar em `.google-oauth.local.json` e
`.telegram.local.json`, ignorados pelo git. Nunca commite esses arquivos: o repositório é público.

</details>

O código e os comentários estão em português.

---

## Dúvidas, problemas ou ideias

Fale comigo — **[abra uma issue aqui](https://github.com/rafatcastro/learnflix-v2/issues/new)**.
Não precisa saber programar nem formatar nada: diga o que aconteceu, em que sistema, e eu respondo.

Se o app não abriu, ajuda muito colar **a mensagem que apareceu na janela** — é ali que ele diz o
motivo.

---

## O que mudou nesta versão

O Learnflix agora é **um programa de verdade**, com janela própria, ícone no Dock e na barra de
tarefas e atualização automática. Antes era preciso abrir o terminal e rodar um comando; hoje é
baixar, instalar e abrir.

- **Sem terminal e sem Node.** O instalador traz tudo dentro.
- **Atualiza sozinho.** Quando sai versão nova, o app avisa e se atualiza com um clique.
- **Cursos do Google Drive.** Cole o link de uma pasta e assista sem baixar nada.
- **Cursos do Telegram (em desenvolvimento).** Cole o link de um grupo ou canal e entre com a sua
  conta pelo QR code; os vídeos viram aulas na ordem em que foram postados.
- **Os mesmos dados.** Quem já usava o Learnflix abre o app e encontra a biblioteca e o progresso
  exatamente como deixou.

---

## Créditos e licença

Fork do [Learnflix v2](https://github.com/OnaitsirC-MiromA/learnflix-v2), de
[OnaitsirC-MiromA](https://github.com/OnaitsirC-MiromA), distribuído sob a licença MIT. O aviso de
copyright original está mantido em [LICENSE](LICENSE).

MIT — use, modifique e compartilhe à vontade.
