#!/usr/bin/env node
// Define (ou audita) o repositório do projeto no GitHub.
//
//   pnpm repo                          # mostra onde o nome aparece e se batem
//   pnpm repo usuario/projeto    # troca em todos os lugares de uma vez
//
// O nome precisa aparecer em quatro arquivos por natureza: a metadata do
// package.json, o README (links das releases), o tauri.conf.json (o endpoint
// de onde o atualizador do app baixa o latest.json) e o aviso de atualização
// (o "Baixar no site" quando a atualização falha). Este script é o "um lugar
// só" — ninguém edita os quatro à mão. Errar o do tauri.conf.json é o pior: o app
// instalado procuraria atualizações num repositório que não é o dele.
//
// A varredura é GENÉRICA de propósito: procura qualquer URL do GitHub nesses
// arquivos, em vez de uma lista de lugares conhecidos. Uma lista esquece — a
// primeira versão deste script esqueceu as URLs nos comentários dos antigos
// instaladores de uma linha, e a auditoria ainda assim disse que estava tudo consistente.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ARQUIVOS = ['package.json', 'README.md', 'desktop/src-tauri/tauri.conf.json', 'web/src/components/AvisoAtualizacao.tsx'];

// O nome do repositório termina em `.git`, `#`, `/`, aspas ou espaço — o
// lookahead impede que o `.git` de `projeto.git` vire parte do nome.
const FIM = '(?=\\.git|[#/"\'\\s]|$)';
const PADROES = [
  // raw.githubusercontent.com vem primeiro e é tratado à parte: o domínio dele
  // NÃO contém "github.com/", então o padrão geral abaixo passa direto por ele —
  // foi assim que as URLs dos instaladores no README ficaram para trás.
  new RegExp(`(raw\\.githubusercontent\\.com/)([\\w.-]+/[\\w.-]+?)${FIM}`, 'g'),
  new RegExp(`(github\\.com/)([\\w.-]+/[\\w.-]+?)${FIM}`, 'g'),
];

// Este repositório é um fork: o README dá crédito ao projeto original com links
// para ele. Esses links não são "o nosso repositório" — nem a auditoria nem a
// troca podem encostar neles.
const ORIGEM = 'OnaitsirC-MiromA/learnflix-v2';

function ocorrencias(texto) {
  const achados = [];
  for (const re of PADROES) {
    for (const m of texto.matchAll(re)) if (m[2] !== ORIGEM) achados.push(m[2]);
  }
  return achados;
}

const novo = process.argv[2];

if (!novo) {
  const porRepo = new Map();
  for (const arquivo of ARQUIVOS) {
    for (const repo of ocorrencias(fs.readFileSync(path.join(raiz, arquivo), 'utf8'))) {
      const lista = porRepo.get(repo) ?? new Set();
      lista.add(arquivo);
      porRepo.set(repo, lista);
    }
  }
  if (porRepo.size === 0) {
    console.error('Nenhuma referência a repositório encontrada — os padrões devem ter saído do lugar.');
    process.exit(1);
  }
  for (const [repo, arquivos] of porRepo) console.log(`${repo}  →  ${[...arquivos].join(', ')}`);
  if (porRepo.size > 1) {
    console.error('\nOs arquivos discordam entre si. Rode: pnpm repo usuario/projeto');
    process.exit(1);
  }
  console.log('\nconsistente. Para trocar: pnpm repo usuario/projeto');
  process.exit(0);
}

if (!/^[\w.-]+\/[\w.-]+$/.test(novo)) {
  console.error(`"${novo}" não parece "usuario/projeto".`);
  process.exit(1);
}

let trocas = 0;
const tocados = [];
for (const arquivo of ARQUIVOS) {
  const caminho = path.join(raiz, arquivo);
  const antes = fs.readFileSync(caminho, 'utf8');
  let depois = antes;
  for (const re of PADROES) {
    depois = depois.replace(re, (todo, prefixo, repo) => {
      if (repo === ORIGEM) return todo;
      trocas++;
      return prefixo + novo;
    });
  }
  if (depois !== antes) {
    fs.writeFileSync(caminho, depois);
    tocados.push(arquivo);
  }
}

console.log(`repositório definido como ${novo}`);
console.log(`${trocas} referências em ${tocados.length} arquivos: ${tocados.join(', ')}`);
