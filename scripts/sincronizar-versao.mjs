#!/usr/bin/env node
// A versão mora num lugar só — o package.json da raiz, de onde também sai o
// APP_VERSION do servidor. O Tauri lê a dele do tauri.conf.json e do Cargo.toml,
// e o atualizador compara justamente essa: se divergir, o app oferece de novo
// a versão que já está instalada.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const versao = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;

const conf = path.join(raiz, 'desktop', 'src-tauri', 'tauri.conf.json');
const json = JSON.parse(fs.readFileSync(conf, 'utf8'));
json.version = versao;
fs.writeFileSync(conf, JSON.stringify(json, null, 2) + '\n');

const cargo = path.join(raiz, 'desktop', 'src-tauri', 'Cargo.toml');
const toml = fs.readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${versao}"`);
fs.writeFileSync(cargo, toml);

console.log(`versão ${versao} em tauri.conf.json e Cargo.toml`);
