import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const pastaSrc = path.dirname(url.fileURLToPath(import.meta.url));
const raizDoServer = path.resolve(pastaSrc, '..');

/**
 * Roda um trecho de TypeScript num processo separado, de dentro de src/ para os
 * imports relativos resolverem como no app de verdade.
 *
 * Precisa ser outro processo: o aviso do node:sqlite sai uma vez só por
 * processo, e a suíte já carregou o módulo muito antes deste teste.
 */
function rodarIsolado(nome: string, codigo: string) {
  const arquivo = path.join(pastaSrc, `__probe-${nome}.ts`);
  fs.writeFileSync(arquivo, `${codigo}\nconsole.log('PROBE-OK');\n`);
  try {
    const r = spawnSync('npx', ['tsx', arquivo], { cwd: raizDoServer, encoding: 'utf8', timeout: 120_000 });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
}

// O node:sqlite deixou de ser experimental em versões recentes do Node (o 26 já
// não avisa). Sem o aviso, o teste de controle abaixo não tem o que provar — e
// falharia por causa do Node, não do app. O guarda do caminho normal continua
// valendo em qualquer versão.
const nodeAvisaSqlite = (spawnSync(process.execPath, ['-e', "require('node:sqlite')"], { encoding: 'utf8' }).stderr ?? '')
  .includes('ExperimentalWarning');

describe('aviso de feature experimental', () => {
  // Guarda de regressão com história: node:sqlite é experimental no Node 22 e o
  // Node grita isso em toda inicialização. Trocar o require() de db/index.ts por
  // um import estático faz o aviso voltar — porque em ESM os módulos embutidos
  // são instanciados ANTES de qualquer corpo de módulo rodar, e o filtro do
  // quiet.ts nunca chegaria a tempo.
  it('não aparece ao abrir o banco pelo caminho normal do app', () => {
    const { stdout, stderr } = rodarIsolado(
      'com-quiet',
      `import './quiet';\nimport { openDb } from './db/index';\nopenDb(':memory:').close();`,
    );

    // Sem isto, um script que nem chegou a rodar passaria no teste.
    expect(stdout).toContain('PROBE-OK');
    expect(stderr).not.toMatch(/ExperimentalWarning/);
  });

  it.skipIf(!nodeAvisaSqlite)('apareceria sem o filtro — é isso que o quiet.ts evita', () => {
    const { stdout, stderr } = rodarIsolado('sem-quiet', `await import('node:sqlite');`);

    expect(stdout).toContain('PROBE-OK');
    expect(stderr).toMatch(/ExperimentalWarning/);
  });
});
