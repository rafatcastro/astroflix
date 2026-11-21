#!/usr/bin/env node
// `pnpm build`: o instalador do Astroflix para ESTA máquina, pronto para instalar.
// O app só existe como desktop, e o build antigo parava no dist/astroflix.cjs: o
// instalador pedia outro comando, que era fácil esquecer. Não há escolha de
// plataforma: o Node SEA copia o Node desta máquina e o Tauri não gera Windows a
// partir do Mac de forma confiável. Os outros sistemas saem do CI.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ehWindows = process.platform === 'win32';

const sistemas = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
if (!sistemas[process.platform]) {
  console.error(`plataforma não suportada: ${process.platform}`);
  process.exit(1);
}

// No Homebrew o rustup é keg-only: o app aberto pelo terminal de quem não mexeu
// no .zshrc não acha o rustc, e o tauri build falha lá no fim, depois de minutos.
function temRust() {
  return spawnSync('rustc', ['--version'], { stdio: 'ignore', shell: ehWindows }).status === 0;
}
if (!temRust() && process.platform === 'darwin') {
  for (const prefixo of ['/opt/homebrew/opt/rustup/bin', '/usr/local/opt/rustup/bin', path.join(process.env.HOME ?? '', '.cargo', 'bin')]) {
    if (fs.existsSync(prefixo)) process.env.PATH = `${prefixo}${path.delimiter}${process.env.PATH}`;
  }
}
if (!temRust()) {
  console.error('rustc não está no PATH. Instale o Rust (rustup) e rode `rustup default stable`.');
  process.exit(1);
}

// Sem estes arquivos (e sem as envs do CI), o app sai sem conta, sem Telegram e
// com todo arquivo do Drive dando 502: funciona, mas não é o app de verdade.
const credenciais = ['.google-oauth.local.json', '.telegram.local.json', '.supabase.local.json'];
const faltam = credenciais.filter((nome) => !fs.existsSync(path.join(raiz, nome)));
if (faltam.length > 0) {
  console.error(`faltam na raiz: ${faltam.join(', ')}\nsem eles o app sai sem conta, sem Telegram e sem Drive.`);
  process.exit(1);
}

function passo(titulo, comando, args) {
  console.log(`\n▸ ${titulo}`);
  const r = spawnSync(comando, args, { cwd: raiz, stdio: 'inherit', shell: ehWindows });
  if (r.status !== 0) {
    console.error(`\nfalhou: ${titulo}`);
    process.exit(r.status ?? 1);
  }
}
const node = (script, ...args) => [process.execPath, [path.join('scripts', script), ...args]];

console.log(`instalador para ${sistemas[process.platform]} (${process.arch})`);
// A versão primeiro: o bundled.ts embute a do package.json.
passo('versão (última release + 1)', ...node('versao-local.mjs'));
passo('interface e servidor', 'pnpm', ['build:servidor']);
passo('executável do servidor', ...node('build-binario.mjs'));
passo('sidecar', ...node('preparar-sidecar.mjs'));
passo('dmg montado de um build anterior', ...node('ejetar-dmg.mjs'));
passo('app e instalador (Tauri)', 'pnpm', ['--filter', 'desktop', 'tauri', 'build', '--ci', '--config', 'src-tauri/tauri.local.conf.json']);

// O que acabou de sair, para quem rodou não ter de procurar na árvore do target.
const versao = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
const bundle = path.join(raiz, 'desktop', 'src-tauri', 'target', 'release', 'bundle');
const instaladores = [];
if (fs.existsSync(bundle)) {
  // Só as pastas (dmg, macos, msi, nsis…): o Finder deixa um .DS_Store aqui.
  for (const tipo of fs.readdirSync(bundle, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    for (const nome of fs.readdirSync(path.join(bundle, tipo))) {
      if (nome.includes(versao) && /\.(dmg|msi|exe|AppImage|deb|rpm)$/.test(nome)) instaladores.push(path.join(bundle, tipo, nome));
    }
  }
}
console.log(`\nAstroflix ${versao} pronto:`);
for (const arquivo of instaladores) console.log(`  ${path.relative(raiz, arquivo)}`);
if (instaladores.length === 0) console.log(`  ${path.relative(raiz, bundle)}`);
