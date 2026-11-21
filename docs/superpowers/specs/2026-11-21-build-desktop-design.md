# `pnpm build` gera o instalador do desktop

## Intenção

O Astroflix só existe como app desktop (o modo navegador saiu), mas o `pnpm build` ainda gerava só
o `dist/astroflix.cjs`, e o instalador pedia outro comando (`pnpm desktop:build`). O dono quer um
comando só: rodar o build e ter o instalador desta máquina pronto para instalar.

## Decisões

- **Sem flag de plataforma.** O instalador só sai para o sistema em que se está (o Node SEA copia o
  Node da máquina; o Tauri não gera Windows a partir do Mac de forma confiável). A plataforma é a
  da máquina; outros sistemas são trabalho do CI.
- `pnpm build` → `scripts/build.mjs`, que faz o que o `desktop:build` fazia: versão da última
  release + 1, interface, servidor, sidecar, ejeção do dmg e `tauri build --ci` com
  `tauri.local.conf.json`. No fim, imprime o caminho do instalador.
- Antes de começar, o script confere: `rustc` no PATH (acrescenta o rustup do Homebrew, que é
  keg-only), os três `.local.json` na raiz (sem eles o app sai sem conta, Telegram e Drive) e a
  plataforma (macOS, Windows, Linux).
- O build antigo vira `build:servidor` (interface → bundled → tipos → esbuild), usado pelo CI
  (`release.yml`, onde o `tauri-action` faz a parte do Tauri, e `verificar.yml`) e pelo próprio
  `build.mjs`.
- Saem `desktop:build`, `desktop:preparar` e `pnpm start` (rodava o `.cjs` num navegador que não
  existe mais).

## Abordagens

- **Script Node orquestrador (escolhida):** dá para checar pré-requisitos e mostrar onde ficou o
  instalador.
- Encadear no `package.json` (como o `desktop:build`): sem checagem nem mensagem final, e a linha já
  estava grande demais.
