import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { AppConfig } from '../config';
import type { ServicosDrive } from '../drive/servicos';
import { isWithinRoots } from './fs';
import { allowedRootsFor } from './settings';
import { apagarBaixados, definirPastaDeArmazenamento, pastaDeArmazenamento, usoDoArmazenamento } from '../armazenamento';

// A seção Armazenamento das Configurações: quanto ocupa o que foi baixado, onde
// fica (dá para trocar), abrir a pasta no Finder/Explorer e limpar.

// Abre no gerenciador de arquivos do sistema. O caminho nunca vem da requisição:
// é a pasta de armazenamento ou a de um curso, as duas lidas do banco.
function abrirNoSistema(pasta: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [pasta]] : process.platform === 'win32' ? ['explorer', [pasta]] : ['xdg-open', [pasta]];
  const p = spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', () => undefined);
  p.unref();
}

export async function armazenamentoRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig; drive?: ServicosDrive }): Promise<void> {
  const { db, config, drive } = opts;

  app.get('/api/armazenamento', async () => usoDoArmazenamento(db, config));

  // Trocar a pasta começa vazio: o que está na antiga fica lá (a pessoa move ou
  // apaga) e deixa de contar como baixado. Os cursos inteiros em andamento
  // continuam, já na pasta nova. `pasta: null` volta ao padrão.
  app.put('/api/armazenamento', async (req, reply) => {
    const pedida = (req.body as { pasta?: unknown } | undefined)?.pasta;
    if (pedida !== null && (typeof pedida !== 'string' || !path.isAbsolute(pedida))) return reply.code(400).send({ error: 'pasta-invalida' });
    const pasta = pedida === null ? null : path.resolve(pedida);
    if (pasta !== null) {
      if (!isWithinRoots(pasta, allowedRootsFor(config, db))) return reply.code(403).send({ error: 'forbidden' });
      try {
        fs.mkdirSync(pasta, { recursive: true });
        const teste = path.join(pasta, `.astroflix-${process.pid}`);
        fs.writeFileSync(teste, '');
        fs.rmSync(teste, { force: true });
      } catch {
        return reply.code(400).send({ error: 'sem-permissao' });
      }
    }
    const destino = pasta ?? config.downloadsDir;
    if (destino === pastaDeArmazenamento(db, config)) return usoDoArmazenamento(db, config);
    const retomar = (await drive?.baixador.pararTudo(false)) ?? [];
    definirPastaDeArmazenamento(db, pasta === config.downloadsDir ? null : pasta);
    fs.mkdirSync(destino, { recursive: true });
    for (const id of retomar) drive?.baixador.baixarCurso(id);
    return usoDoArmazenamento(db, config);
  });

  app.post('/api/armazenamento/abrir', async (req, reply) => {
    const courseId = (req.body as { courseId?: unknown } | undefined)?.courseId;
    let pasta = pastaDeArmazenamento(db, config);
    if (typeof courseId === 'string') {
      const r = db.prepare('SELECT pasta, raiz, conectada FROM pastas_baixadas WHERE course_id=?').get(courseId) as
        | { pasta: string; raiz: string; conectada: number }
        | undefined;
      // A pasta conectada é da pessoa: abre se existir, e nunca é criada.
      if (r?.conectada) {
        if (!fs.existsSync(r.pasta)) return reply.code(404).send({ error: 'pasta-sumiu' });
        abrirNoSistema(r.pasta);
        return reply.code(204).send();
      }
      if (r && r.raiz === pasta && fs.existsSync(r.pasta)) pasta = r.pasta;
    }
    fs.mkdirSync(pasta, { recursive: true });
    abrirNoSistema(pasta);
    return reply.code(204).send();
  });

  // Limpar: para todos os downloads e apaga tudo o que o app baixou na pasta atual.
  // O progresso e os cursos ficam; as aulas voltam a tocar pela rede.
  app.delete('/api/armazenamento', async () => {
    await drive?.baixador.pararTudo(true);
    apagarBaixados(db, config);
    return usoDoArmazenamento(db, config);
  });
}
