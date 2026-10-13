# App desktop com Tauri — plano de implementação

**Spec:** `docs/specs/2026-10-12-app-desktop-tauri-design.md`
**Execução:** direto nesta sessão (pedido de agilidade), com uma revisão final do branch inteiro.

## Restrições globais

- Dados no mesmo `DATA_DIR`; nenhuma mudança de schema.
- `pnpm dev` no navegador não muda de comportamento. Fora do Tauri, a interface faz exatamente o
  que faz hoje.
- Nenhuma chave privada no git: tanto a do updater quanto as `GOOGLE_*` ficam em arquivos
  `.local` ignorados e em secrets.

## Tarefa 1 — Modo desktop no servidor (TDD)

- `config.ts`: `desktop: boolean` (`LEARNFLIX_DESKTOP === '1'`). Com `desktop`, `openBrowser` é
  `false`, a menos que `OPEN_BROWSER` venha explícito.
- `server/src/desktop.ts`:
  - `linhaDaUrl(url: string): string`, que devolve `LEARNFLIX_URL=<url>`;
  - `pathComExtras(path: string, plataforma, existe: (d) => boolean, env): string`, que acrescenta
    só os diretórios que existem, sem duplicar.
- `index.ts`: em modo desktop, aplica `pathComExtras` em `process.env.PATH` **antes** da primeira
  detecção do ffmpeg e escreve `linhaDaUrl(url)` depois do `listen`.
- Testes: `config.test.ts` e `desktop.test.ts`.

## Tarefa 2 — Interface sabe que está no desktop

- `web/src/lib/desktop.ts`:
  - `emDesktop()`, que checa `'__TAURI_INTERNALS__' in window`;
  - `abrirFora(url)`, que no desktop chama `openUrl` do `@tauri-apps/plugin-opener` com a URL
    absoluta e, fora dele, chama `window.open(url, '_blank')`.
- `driveAuth.ts`: no desktop, abre o login com `abrirFora` e espera a conexão consultando
  `/api/drive/status`, como no ramo de popup bloqueado.
- Os links "Baixar" de materiais, o export da biblioteca e o "Abrir a autorização" usam
  `abrirFora` no desktop. O visualizador embutido de PDF/imagem continua igual.
- Aviso de atualização: `web/src/components/AvisoAtualizacao.tsx`, só no desktop, com
  `@tauri-apps/plugin-updater` (`check`, `downloadAndInstall`) e `@tauri-apps/plugin-process`
  (`relaunch`), montado em `App.tsx`. Texto: "Nova versão disponível · Atualizar".
- Verificação: `pnpm build`.

## Tarefa 3 — Projeto Tauri

- `desktop/package.json` (`@tauri-apps/cli`), adicionado ao `pnpm-workspace.yaml`.
- `desktop/src-tauri`:
  - Cargo com `tauri`, `tauri-plugin-shell`, `tauri-plugin-opener`, `tauri-plugin-updater`,
    `tauri-plugin-process` e `tauri-plugin-single-instance`;
  - `tauri.conf.json`, com `externalBin: ["binaries/learnflix-server"]`, `frontendDist:
    "../carregando"` e a pubkey e o endpoint do updater;
  - `capabilities/default.json`: shell só para o sidecar, `opener:allow-open-url`, updater e
    process, liberados também para a origem remota `http://localhost:*`.
- `main.rs`:
  - instância única que foca a janela existente;
  - `spawn` do sidecar com `LEARNFLIX_DESKTOP=1`;
  - lê o stdout até `LEARNFLIX_URL=` e navega a janela;
  - se passar de 20 s ou o sidecar sair, navega para `carregando/index.html#erro=<motivo>`;
  - `RunEvent::Exit` mata o sidecar.
- `desktop/carregando/index.html`: "Abrindo o Learnflix…" e o estado de erro com "Tentar de novo",
  que chama um comando `reiniciar`.
- `scripts/preparar-sidecar.mjs`: copia `build/learnflix[.exe]` para
  `binaries/learnflix-server-<triple>`, com o triple vindo de `rustc -vV`.
- `scripts/sincronizar-versao.mjs`: copia a versão do `package.json` para o `tauri.conf.json`.
- Ícones: `tauri icon web/public/icon-512.png`.
- Scripts na raiz:
  - `desktop:build` roda o build, o binário, o sidecar, a versão e o `tauri build`;
  - `desktop:dev` faz o mesmo com `tauri dev`.
- Par de chaves do updater gerado com `tauri signer generate` em `.tauri-signing.local.key`, que
  vai para o `.gitignore`.
- Verificação: `cargo check`, depois `pnpm desktop:build` no macOS arm64 e a checagem manual
  da spec.

## Tarefa 4 — Distribuição e documentação

- `release.yml`:
  - o job `testar` continua;
  - a matriz `desktop` usa `macos-14`, `macos-15-intel`, `windows-latest` e `ubuntu-22.04` (com as
    dependências do webkit2gtk);
  - os passos são: `pnpm install`, `pnpm build` (com as `GOOGLE_*`), `build:binario`,
    `preparar-sidecar`, `sincronizar-versao` e `tauri-apps/tauri-action` (com as `TAURI_SIGNING_*`,
    `tagName` e `includeUpdaterJson`).
  - O job do npm sai.
- Removidos: `install.sh`, `install.ps1` e o `bin`. O `package.json` passa a ser
  `"private": true`.
- `definir-repo.mjs` passa a olhar `package.json`, `README.md` e `desktop/src-tauri/tauri.conf.json`.
- O README é reescrito em torno do download do instalador, e o `AGENTS.md` é atualizado.
- Verificação: `pnpm test && pnpm build && pnpm repo`.

## Revisão

No fim, uma revisão do branch inteiro. Depois, push na `main`, que é a regra do repositório.
