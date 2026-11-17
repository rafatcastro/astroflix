#!/usr/bin/env node
// Antes do `tauri build` local, no macOS: ejeta o .dmg anterior que ficou montado
// (quem acabou de instalar costuma deixar "Astroflix" aberto no Finder) e os
// "dmg.XXXXXX" que um build interrompido deixa. Com eles montados, o
// bundle_dmg.sh falha sem dizer por quê e o build termina com erro.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin' && fs.existsSync('/Volumes')) {
  for (const nome of fs.readdirSync('/Volumes')) {
    if (!/^Astroflix( \d+)?$|^dmg\.[A-Za-z0-9]{6}$/.test(nome)) continue;
    try {
      execFileSync('hdiutil', ['detach', `/Volumes/${nome}`, '-force'], { stdio: 'ignore' });
      console.log(`ejetado /Volumes/${nome}`);
    } catch {
      console.warn(`não deu para ejetar /Volumes/${nome}`);
    }
  }
}

// A imagem gravável (rw.<pid>.<nome>.dmg) que um bundle_dmg.sh que falhou deixa
// em bundle/macos: ~200 MB cada, e ninguém mais a usa.
const macos = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'macos');
if (fs.existsSync(macos)) {
  for (const nome of fs.readdirSync(macos)) if (/^rw\.\d+\..*\.dmg$/.test(nome)) fs.rmSync(path.join(macos, nome), { force: true });
}
