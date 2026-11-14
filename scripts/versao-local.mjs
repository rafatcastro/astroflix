#!/usr/bin/env node
// Antes do `pnpm desktop:build`: dá ao build desta máquina uma versão acima da
// última release (v<major.minor>.N → N+1). Com a versão do package.json (2.1.0),
// o atualizador achava a release "mais nova" ao abrir e se instalava por cima:
// em 11/2026, com o CI parado, o build local virou a 2.1.55 de semanas antes e as
// funções novas sumiram. Quando o CI volta, o número da execução dele já passou
// deste (as execuções que falharam também contam), e a atualização segue normal.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
  } catch {
    return '';
  }
};
// As tags do GitHub primeiro (são as releases); sem rede, as que este clone conhece.
const tags = git('ls-remote', '--tags', 'origin') || git('tag', '-l');
const prefixo = `v${major}.${minor}.`;
let ultima = -1;
for (const m of tags.matchAll(/v(\d+)\.(\d+)\.(\d+)/g)) {
  if (`v${m[1]}.${m[2]}.` === prefixo) ultima = Math.max(ultima, Number(m[3]));
}
if (ultima < 0) console.warn(`nenhuma tag ${prefixo}* achada: o atualizador pode trocar este build por uma release`);

const versao = `${major}.${minor}.${Math.max(patch, ultima + 1)}`;
execFileSync('node', [path.join(raiz, 'scripts', 'sincronizar-versao.mjs'), versao], { stdio: 'inherit' });
