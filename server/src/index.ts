// Primeiro import de todos, de propósito — ver quiet.ts.
import './quiet';
import fs from 'node:fs';
import { loadConfig } from './config';
import { APP_VERSION } from './bundled';
import { openDb } from './db/index';
import { herdarDadosDoV1 } from './db/legacy';
import { buildApp } from './app';
import { escutarComFallback } from './listen';
import { mensagemDeBoot } from './banner';
import { hasFfmpeg } from './media/ffmpeg';
import { linhaDaUrl, linhaDeDownload, pathComExtras } from './desktop';
import { corrigirCaminhos, moverPastaDeDados } from './pasta-de-dados';
import { pastaDeArmazenamento, reorganizarBaixados } from './armazenamento';

// Antes do loadConfig: se não deu para mover a pasta antiga, ele tem de apontar para ela.
const mudanca = moverPastaDeDados();
const config = loadConfig();

// Antes da primeira detecção do ffmpeg (o resultado fica em cache): aberto pelo
// Dock, o app desktop não herda o PATH do terminal — ver desktop.ts.
process.env.PATH = pathComExtras(process.env.PATH ?? '', process.platform, fs.existsSync, process.env);

// Antes de abrir o banco: se o app subiu de dentro da pasta do v1 e ainda não há
// banco novo, o histórico de lá é adotado. Depois do openDb seria tarde — ele
// criaria um banco vazio e a herança nunca aconteceria.
const heranca = herdarDadosDoV1(process.cwd(), config.dataDir);

for (const dir of [config.dataDir, config.thumbsDir, config.convertedDir, config.downloadsDir, config.cacheDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = openDb(config.dbPath);
let portaReal: number | null = null;
if (mudanca?.movida) corrigirCaminhos(db, mudanca.antiga, config.dataDir);
// A v17 devolveu às pastas os cursos do Drive que estavam mapeados; o que já foi
// baixado deles ainda está em `NN - Módulo/NN - Título.ext` e volta à estrutura das
// pastas aqui (a migração não tem a config). Antes do buildApp, que retoma os
// downloads: nada está escrevendo nessas pastas ainda.
const paraReorganizar = db.prepare("SELECT value FROM settings WHERE key='mapa.reorganizar'").get() as { value: string } | undefined;
if (paraReorganizar) {
  let ids: string[] = [];
  try {
    ids = JSON.parse(paraReorganizar.value) as string[];
  } catch {
    // Chave estragada: não há o que reorganizar com ela.
  }
  // Só sai da lista o curso cuja reorganização aconteceu. A pasta do curso no
  // armazenamento fora do ar (disco externo desligado) fazia o reorganizarBaixados
  // voltar sem mexer em nada, e a chave apagada deixava esses downloads para sempre
  // no caminho do mapeamento antigo: o id fica para a próxima abertura. Curso sem
  // pasta de download (nunca baixou) ou já excluído não tem o que esperar.
  const raiz = pastaDeArmazenamento(db, config);
  const pastaDe = db.prepare('SELECT pasta FROM pastas_baixadas WHERE course_id=? AND raiz=?');
  const faltam: string[] = [];
  for (const id of ids) {
    const pasta = (pastaDe.get(id, raiz) as { pasta: string } | undefined)?.pasta;
    if (pasta && !fs.existsSync(pasta)) {
      faltam.push(id);
      continue;
    }
    try {
      reorganizarBaixados(db, config, id);
    } catch (err) {
      console.error(`Não deu para reorganizar os downloads do curso ${id}:`, err);
      faltam.push(id);
    }
  }
  if (faltam.length > 0) db.prepare("UPDATE settings SET value=? WHERE key='mapa.reorganizar'").run(JSON.stringify(faltam));
  else db.prepare("DELETE FROM settings WHERE key='mapa.reorganizar'").run();
}
const app = buildApp(config, db, {
  retomarDownloads: true,
  exigirConta: true,
  aoBaixar: (baixando) => console.log(linhaDeDownload(baixando)),
  porta: () => portaReal,
});

const shutdown = () => {
  app.close().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Numa função, e não com await no topo do módulo: o empacotamento gera
// CommonJS — exigência do executável único — e CommonJS não tem top-level await.
async function subir(): Promise<void> {
  try {
    const { port, trocou } = await escutarComFallback(app, config.port, config.bind);
    portaReal = port;
    const url = `http://localhost:${port}`;

    console.log(
      mensagemDeBoot({
        versao: APP_VERSION,
        dataDir: config.dataDir,
        url,
        temFfmpeg: hasFfmpeg(),
        trocouDePorta: trocou,
        portaPedida: config.port,
        herdouDoV1: heranca === 'adotado',
        plataforma: process.platform,
      }).join('\n'),
    );

    console.log(linhaDaUrl(url));
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

void subir();
