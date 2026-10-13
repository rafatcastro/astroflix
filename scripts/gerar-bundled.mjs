#!/usr/bin/env node
// Gera server/src/bundled.ts — o módulo com tudo o que o build "congela" dentro
// do app: os arquivos da interface e a versão.
//
// Existe para o servidor não depender do diretório de onde foi iniciado. No v1,
// a SPA era procurada em `cwd/../web/dist` e a versão lida de `cwd/../package.json`
// — as duas coisas quebravam se o processo subisse de outro lugar, e nenhuma
// delas sobreviveria a virar um executável único.
//
// Roda antes do typecheck, do teste e do bundle. Sem web/dist, gera um módulo
// vazio: é o estado normal em desenvolvimento, onde quem serve a interface é o
// Vite.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const webDist = path.join(raiz, 'web', 'dist');
const destino = path.join(raiz, 'server', 'src', 'bundled.ts');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function listar(dir, base = '') {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, item.name);
    // Sempre com barra normal: a chave é uma URL, não um caminho de disco — no
    // Windows, path.join daria barra invertida e nenhuma rota casaria.
    const rel = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) saida.push(...listar(completo, rel));
    else saida.push({ rel, completo });
  }
  return saida;
}

const versao = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
const arquivos = fs.existsSync(webDist) ? listar(webDist) : [];

// Credenciais do app do Google embutidas como padrão. NÃO vão para o git: o
// segredo de um cliente OAuth e a chave de API de um projeto pessoal não podem
// vazar no repositório público. Vêm das envs GOOGLE_* ou, na falta delas, de
// .google-oauth.local.json (ignorado pelo git); o build de release as injeta.
// Sem nenhuma fonte, ficam null e o app pede as credenciais nas Configurações.
function lerCredenciaisPadrao() {
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(path.join(raiz, '.google-oauth.local.json'), 'utf8'));
  } catch {
    // arquivo ausente ou ilegível: segue só com as envs
  }
  const pegar = (env, chave) => process.env[env] || local[chave] || null;
  return {
    clientId: pegar('GOOGLE_CLIENT_ID', 'clientId'),
    clientSecret: pegar('GOOGLE_CLIENT_SECRET', 'clientSecret'),
    apiKey: pegar('GOOGLE_API_KEY', 'apiKey'),
  };
}
const google = lerCredenciaisPadrao();

// Mesma regra para o app do Telegram (api_id/api_hash de my.telegram.org): envs
// TELEGRAM_* ou .telegram.local.json, nunca o git.
function lerTelegramPadrao() {
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(path.join(raiz, '.telegram.local.json'), 'utf8'));
  } catch {
    // arquivo ausente ou ilegível: segue só com as envs
  }
  const id = Number(process.env.TELEGRAM_API_ID || local.apiId);
  return {
    apiId: Number.isInteger(id) && id > 0 ? id : null,
    apiHash: process.env.TELEGRAM_API_HASH || local.apiHash || null,
  };
}
const telegram = lerTelegramPadrao();

// Projeto Supabase da conta (login obrigatório e nuvem). A chave é a publishable,
// feita para viver dentro do app: quem protege os dados é a RLS do banco. Mesmo
// assim fica fora do git, como as outras: envs SUPABASE_* ou .supabase.local.json.
// Sem as duas, o app roda sem conta (fork ou desenvolvimento sem projeto).
function lerSupabasePadrao() {
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(path.join(raiz, '.supabase.local.json'), 'utf8'));
  } catch {
    // arquivo ausente ou ilegível: segue só com as envs
  }
  return {
    url: process.env.SUPABASE_URL || local.url || null,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || local.publishableKey || null,
  };
}
const supabase = lerSupabasePadrao();

const entradas = arquivos.map(({ rel, completo }) => {
  const tipo = TIPOS[path.extname(rel).toLowerCase()] ?? 'application/octet-stream';
  const base64 = fs.readFileSync(completo).toString('base64');
  return `  ${JSON.stringify('/' + rel)}: { tipo: ${JSON.stringify(tipo)}, base64: ${JSON.stringify(base64)} },`;
});

fs.writeFileSync(
  destino,
  `// GERADO por scripts/gerar-bundled.mjs — não edite à mão.
//
// Cada arquivo da interface entra aqui em base64 para o servidor poder entregá-lo
// sem tocar no disco. É o que permite o app inteiro caber num arquivo só.
export interface AssetEmbutido {
  tipo: string;
  base64: string;
}

export const APP_VERSION = ${JSON.stringify(versao)};

export const GOOGLE_PADRAO: { clientId: string | null; clientSecret: string | null; apiKey: string | null } = ${JSON.stringify(google)};

export const TELEGRAM_PADRAO: { apiId: number | null; apiHash: string | null } = ${JSON.stringify(telegram)};

export const SUPABASE_PADRAO: { url: string | null; publishableKey: string | null } = ${JSON.stringify(supabase)};

export const WEB_ASSETS: Record<string, AssetEmbutido> = {
${entradas.join('\n')}
};
`,
);

const total = arquivos.reduce((n, a) => n + fs.statSync(a.completo).size, 0);
console.log(
  arquivos.length
    ? `bundled.ts: ${arquivos.length} arquivos da interface (${(total / 1024).toFixed(0)} KB), versão ${versao}`
    : `bundled.ts: sem web/dist — interface fica por conta do Vite (versão ${versao})`,
);
