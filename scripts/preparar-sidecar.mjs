#!/usr/bin/env node
// Coloca o executável do servidor (pnpm build:binario) onde o Tauri procura o
// sidecar: desktop/src-tauri/binaries/learnflix-server-<target-triple>[.exe].
// O Tauri exige o target triple do Rust no nome — é como ele escolhe o binário
// certo de cada plataforma no bundle.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ehWindows = process.platform === 'win32';
const origem = path.join(raiz, 'build', ehWindows ? 'learnflix.exe' : 'learnflix');

if (!fs.existsSync(origem)) {
  console.error(`${path.relative(raiz, origem)} não existe — rode \`pnpm build:binario\` antes.`);
  process.exit(1);
}

const saida = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
const triple = /^host: (\S+)$/m.exec(saida)?.[1];
if (!triple) {
  console.error('não consegui descobrir o target triple pelo `rustc -vV`.');
  process.exit(1);
}

const pasta = path.join(raiz, 'desktop', 'src-tauri', 'binaries');
fs.mkdirSync(pasta, { recursive: true });
const destino = path.join(pasta, `learnflix-server-${triple}${ehWindows ? '.exe' : ''}`);
fs.copyFileSync(origem, destino);
fs.chmodSync(destino, 0o755);
console.log(`sidecar: ${path.relative(raiz, destino)}`);
