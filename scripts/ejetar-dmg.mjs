#!/usr/bin/env node
// Antes do `tauri build` local, no macOS: ejeta o .dmg anterior que ficou montado
// (quem acabou de instalar costuma deixar "Astroflix" aberto no Finder) e os
// "dmg.XXXXXX" que um build interrompido deixa. Com eles montados, o
// bundle_dmg.sh falha sem dizer por quê e o build termina com erro.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

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
