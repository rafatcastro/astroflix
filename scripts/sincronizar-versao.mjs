#!/usr/bin/env node
// A versão mora num lugar só — o package.json da raiz, de onde também sai o
// APP_VERSION do servidor. O Tauri lê a dele do tauri.conf.json e do Cargo.toml,
// e o atualizador compara justamente essa: se divergir, o app oferece de novo
// a versão que já está instalada.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
// A CI passa a versão da release (major.minor + número da execução) e ela é
// gravada também no package.json, de onde o gerar-bundled tira o APP_VERSION.
const pkgPath = path.join(raiz, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const versao = process.argv[2] ?? pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(versao)) {
  console.error(`versão inválida: ${versao}`);
  process.exit(1);
}
if (pkg.version !== versao) {
  pkg.version = versao;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const conf = path.join(raiz, 'desktop', 'src-tauri', 'tauri.conf.json');
const json = JSON.parse(fs.readFileSync(conf, 'utf8'));
json.version = versao;
fs.writeFileSync(conf, JSON.stringify(json, null, 2) + '\n');

const cargo = path.join(raiz, 'desktop', 'src-tauri', 'Cargo.toml');
const toml = fs.readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${versao}"`);
fs.writeFileSync(cargo, toml);

console.log(`versão ${versao} em package.json, tauri.conf.json e Cargo.toml`);
