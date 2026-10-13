# App desktop com Tauri — design

**Data:** 2026-10-12

## Problema

Hoje o Learnflix roda pelo terminal (`npx learnflix` ou um instalador de uma linha) e abre no
navegador. Isso afasta quem não usa terminal. Também deixa o app sem janela própria, sem ícone no
Dock ou na barra de tarefas e sem atualização automática.

Objetivo: o Learnflix vira um **programa desktop** instalável (`.dmg`, `.msi`, `.AppImage`/`.deb`),
com janela própria e atualização automática. Ele **substitui** o `npx` e os instaladores de uma
linha.

## Decisões

| Decisão | Escolha |
|---|---|
| Tecnologia | Tauri v2 (casca em Rust com a webview do sistema) |
| Servidor | O servidor Node atual, sem mudança de arquitetura, empacotado como **sidecar** (o executável Node SEA que `pnpm build:binario` já gera) |
| Reescrever em Rust | Não. Seriam semanas de trabalho e risco de regressão para economizar ~100 MB |
| Plataformas | macOS (Apple Silicon e Intel), Windows x64, Linux x64 — as mesmas das releases atuais |
| Distribuição | Só o app desktop. Saem o `npx learnflix`, a publicação no npm, `install.sh`/`install.ps1` e o executável avulso |
| Atualização | Automática, com `tauri-plugin-updater` e atualizações assinadas com chave do Tauri |
| Dados | Os mesmos de hoje (`~/.learnflix`, `%LOCALAPPDATA%\Learnflix`): quem já usava não perde nada |
| Login do Google | No **navegador do sistema**, porque o Google bloqueia OAuth em webview embutida (`disallowed_useragent`) |
| Certificado pago (Apple/Microsoft) | Fora desta etapa. Os avisos de "desenvolvedor não identificado" e SmartScreen continuam, como hoje |

## Arquitetura

```
desktop/
  package.json            # @tauri-apps/cli; scripts desktop:dev / desktop:build
  src-tauri/
    Cargo.toml
    tauri.conf.json       # janela, sidecar, updater, bundle
    capabilities/         # permissões mínimas (shell sidecar, opener, updater)
    src/main.rs           # sobe o sidecar, lê a URL, carrega na janela
    binaries/             # learnflix-server-<target-triple>[.exe], gerado no build, fora do git
    icons/
  carregando/index.html   # tela "Abrindo o Learnflix…" (frontendDist do Tauri)
```

`desktop` entra no `pnpm-workspace.yaml`.

### Sequência de abertura

1. O Tauri mostra `carregando/index.html` na janela principal, com o fundo `#0a0a0a` do design e
   o texto "Abrindo o Learnflix…".
2. O `main.rs` sobe o sidecar `learnflix-server` com a variável `LEARNFLIX_DESKTOP=1`.
3. O servidor sobe como hoje (porta 7777, ou a seguinte se estiver ocupada). Em modo desktop:
   - **não** abre o navegador;
   - escreve na saída padrão uma linha de máquina, `LEARNFLIX_URL=http://localhost:<porta>`,
     além do banner humano.
4. O `main.rs` lê a saída do sidecar até encontrar essa linha e navega a janela para a URL.
5. Se o sidecar morrer ou não emitir a linha em 20 s, a janela mostra "Não foi possível abrir o
   Learnflix", com o motivo (as últimas linhas da saída de erro) e um botão "Tentar de novo".

A janela carrega a interface **pela mesma origem do servidor**. Por isso a `guarda.ts`, o CORS e
os cookies não mudam.

### Ciclo de vida

- **Instância única** (`tauri-plugin-single-instance`): abrir o app de novo traz a janela
  existente para a frente.
- **Fechar a última janela encerra o app** em todas as plataformas, inclusive no macOS. O
  `main.rs` mata o sidecar no evento de saída, para não sobrar processo. O servidor já trata
  `SIGTERM`, fechando o Fastify e o banco.
- Um sidecar que morre sozinho durante o uso cai no estado de erro do passo 5.

### Integração com o sistema

- **Links externos e login do Google:** `window.open`, links `target="_blank"` e
  `Content-Disposition: attachment` não funcionam bem numa webview. Em modo desktop, a interface
  troca essas aberturas por `tauri-plugin-opener` (`openUrl`), que abre o navegador do sistema.
  - **Login do Google:** a URL de autorização abre no navegador do sistema. O app espera a conexão
    consultando `/api/drive/status`, o mesmo caminho já usado quando o popup é bloqueado. O
    callback continua no servidor local (loopback), e a página do callback mostra "Pode fechar
    esta janela".
  - **Materiais:** "Abrir" abre no navegador do sistema, e "Baixar" abre a URL com `?download=1`
    no navegador, que faz o download.
  - A detecção de modo desktop é feita por `window.__TAURI_INTERNALS__`, num helper único,
    `web/src/lib/desktop.ts`. Fora do Tauri, o comportamento atual não muda.
- **ffmpeg fora do PATH:** um app aberto pelo Dock ou pelo menu Iniciar não herda o PATH do
  terminal. Em modo desktop, o servidor acrescenta ao PATH, se existirem: `/opt/homebrew/bin` e
  `/usr/local/bin` no macOS; `/usr/local/bin` e `/usr/bin` no Linux;
  `%ProgramFiles%\ffmpeg\bin` e o diretório de links do WinGet no Windows. Sem isso, capas e
  duração sumiriam no app.

### Atualização

- `tauri-plugin-updater`, com o endpoint
  `https://github.com/rafatcastro/learnflix-v2/releases/latest/download/latest.json`, gerado pelo
  `tauri-action`.
- Par de chaves gerado com `tauri signer generate`:
  - a pública vai em `tauri.conf.json`;
  - a privada e a senha vão para os secrets `TAURI_SIGNING_PRIVATE_KEY` e
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, e para fora do git (`.tauri-signing.local.key`, no
    `.gitignore`).
- Ao abrir, o app confere em segundo plano. Se houver versão nova, mostra um aviso discreto no
  topo, "Nova versão disponível · Atualizar", que baixa, instala e reinicia. Sem rede, nada
  aparece.
- `version` vem do `package.json` da raiz, a mesma fonte do `APP_VERSION`, sincronizada em
  `tauri.conf.json` por um script.

### Build

- `pnpm desktop:build`:
  1. `pnpm build`;
  2. `pnpm build:binario`;
  3. copia `build/learnflix[.exe]` para
     `desktop/src-tauri/binaries/learnflix-server-<target-triple>[.exe]`, com o triple vindo de
     `rustc -vV`;
  4. roda `tauri build`.
- `pnpm desktop:dev`: o mesmo, com `tauri dev`. A interface vem do servidor, então o hot reload
  do Vite não se aplica aqui. Para iterar na interface, continua valendo o `pnpm dev` no
  navegador.
- **CI (`release.yml`)**, um runner por plataforma: `macos-14` (arm64), `macos-15-intel` (x64),
  `windows-latest` e `ubuntu-22.04`. Cada um:
  1. gera o sidecar nativo;
  2. roda `tauri-apps/tauri-action`, que gera o instalador e o `latest.json` e anexa tudo à
     release da tag.

  O job do npm sai. O teste continua num job inicial com `pnpm test`. As credenciais do Google
  continuam injetadas no build pelos secrets `GOOGLE_*`.

## O que sai

- `bin` e a publicação no npm: o `package.json` da raiz vira `"private": true`.
- `install.sh`, `install.ps1` e o job `publicar` (npm e anexos de binário avulso).
- `scripts/definir-repo.mjs` deixa de procurar o nome do repositório nos instaladores removidos.
  A lista passa a ser `package.json`, `README.md` e `desktop/src-tauri/tauri.conf.json` (o
  endpoint do updater).
- README: "Como rodar" passa a ser "Baixe o instalador", com links da página de releases e a
  explicação dos avisos de sistema. "Desenvolvimento" ganha o pré-requisito do Rust e o
  `pnpm desktop:dev`.
- `AGENTS.md`: `desktop/`, o modo `LEARNFLIX_DESKTOP` e o novo caminho de distribuição.

## O que não muda

Telas, atalhos, banco, scan, stream, Drive e backup continuam iguais. O `pnpm dev`, com a
interface no navegador, segue como o modo de desenvolvimento do dia a dia.

## Testes

TDD no servidor:

- `config.test.ts`: `LEARNFLIX_DESKTOP=1` desliga `openBrowser`, e `OPEN_BROWSER` explícito
  continua valendo.
- `server/src/desktop.test.ts` (módulo novo `desktop.ts`, chamado pelo `index.ts`): em modo desktop, a linha `LEARNFLIX_URL=` sai
  exatamente uma vez, com a porta real (inclusive depois de pular uma porta ocupada).
- `media/ffmpeg.test.ts`: a função pura que monta o PATH acrescenta só os diretórios que
  existem, sem duplicar, para cada plataforma. A sonda de existência é injetada.
- `web`: `desktop.ts` é verificado pelo build.

Rust e empacotamento são verificados por `cargo check` e `tauri build` nesta máquina (macOS arm64)
e pela CI nas outras plataformas.

Checagem manual no macOS:

- abrir o app pelo Finder;
- assistir uma aula e conferir que a posição volta depois de fechar e abrir;
- abrir duas vezes e ver a mesma janela vir para a frente;
- fechar e confirmar que não sobra processo `learnflix-server`;
- adicionar uma pasta do Drive privada, com o login abrindo no navegador do sistema;
- baixar um material;
- testar o atualizador com uma versão de teste.

## Fora desta etapa

- Assinatura e notarização pagas (Apple Developer, certificado de código no Windows).
- Bandeja do sistema e app que continua aberto sem janela.
- Reescrever o servidor em Rust.
- Builds ARM para Windows e Linux.
