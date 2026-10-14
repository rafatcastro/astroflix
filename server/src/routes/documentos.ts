import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { transaction, type Db } from '../db';
import type { AppConfig } from '../config';
import { allowedRootsFor } from './settings';
import { isWithinRoots } from './fs';
import { servirArquivo } from './stream';
import { cleanTitle, naturalCompare } from '../scan/derive';

// PDFs (livros, questões, apostilas). Cada um é um arquivo do disco que o app só
// lê: nunca copia, nunca altera, e "remover" tira só daqui. A leitura (página
// onde parou, lido) mora no banco e sobe para a conta; o arquivo não.

const ehPdf = (nome: string) => path.extname(nome).toLowerCase() === '.pdf';

// A pasta escolhida pode ser a home inteira: a leitura é síncrona e trava o
// servidor enquanto corre, então tem teto, como o temVideo de fs.ts.
const PROFUNDIDADE_MAX = 6;
const ENTRADAS_MAX = 20_000;

function pdfsDaPasta(dir: string, orcamento = { entradas: ENTRADAS_MAX }, nivel = 1): string[] {
  if (nivel > PROFUNDIDADE_MAX || orcamento.entradas <= 0) return [];
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  orcamento.entradas -= entradas.length;
  const saida: string[] = [];
  for (const e of entradas.sort((a, b) => naturalCompare(a.name, b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const completo = path.join(dir, e.name);
    if (e.isFile() && ehPdf(e.name)) saida.push(completo);
    else if (e.isDirectory()) saida.push(...pdfsDaPasta(completo, orcamento, nivel + 1));
  }
  return saida;
}

interface LinhaDocumento {
  id: string;
  titulo: string;
  categoria: string | null;
  caminho: string;
  tamanho: number;
  paginas: number | null;
  pagina: number;
  lido: number;
  lido_em: string | null;
  leitura_em: string | null;
  criado_em: string;
}

const categoriaLimpa = (c: unknown): string | null => (typeof c === 'string' && c.trim() ? c.trim().slice(0, 60) : null);

export async function documentosRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }): Promise<void> {
  const { db, config } = opts;
  const raizes = () => allowedRootsFor(config, db);
  const capaDe = (id: string) => path.join(config.thumbsDir, `documento-${id}.png`);
  // A capa é a primeira página desenhada pela própria interface (o pdf.js já está
  // lá; no servidor seria outra dependência só para isso), e chega aqui pronta.
  app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, corpo, done) => done(null, corpo));

  // Arquivo que sumiu (HD desligado, PDF movido) ou que veio da conta e ainda não
  // tem caminho nesta máquina: aparece, com "Re-apontar", em vez de sumir.
  const disponivel = (caminho: string) =>
    !!caminho && isWithinRoots(caminho, raizes()) && fs.existsSync(caminho) && fs.statSync(caminho).isFile();

  const dto = (d: LinhaDocumento) => ({
    id: d.id,
    titulo: d.titulo,
    categoria: d.categoria,
    caminho: d.caminho,
    tamanho: d.tamanho,
    paginas: d.paginas,
    pagina: d.pagina,
    lido: !!d.lido,
    lidoEm: d.lido_em,
    leituraEm: d.leitura_em,
    criadoEm: d.criado_em,
    disponivel: disponivel(d.caminho),
    temCapa: fs.existsSync(capaDe(d.id)),
  });
  const buscar = (id: string) => db.prepare('SELECT * FROM documentos WHERE id=?').get(id) as LinhaDocumento | undefined;

  app.get('/api/documentos', async () => {
    const linhas = db.prepare('SELECT * FROM documentos').all() as unknown as LinhaDocumento[];
    // Os lidos por último primeiro (é o que a pessoa quer retomar); os nunca abertos
    // depois, pela ordem do título.
    linhas.sort((a, b) => {
      if (a.leitura_em || b.leitura_em) return (b.leitura_em ?? '').localeCompare(a.leitura_em ?? '');
      return naturalCompare(a.titulo, b.titulo);
    });
    return linhas.map(dto);
  });

  app.get('/api/documentos/:id', async (req, reply) => {
    const d = buscar((req.params as { id: string }).id);
    return d ? dto(d) : reply.code(404).send({ error: 'not_found' });
  });

  // Arquivos escolhidos e/ou uma pasta (cada PDF dentro dela, subpastas inclusive).
  // Idempotente: um PDF que já está aqui (mesmo caminho) não duplica.
  app.post('/api/documentos', async (req, reply) => {
    const body = (req.body ?? {}) as { caminhos?: unknown; pasta?: unknown; categoria?: unknown };
    const candidatos: string[] = [];
    if (Array.isArray(body.caminhos)) {
      for (const c of body.caminhos) if (typeof c === 'string' && c) candidatos.push(path.resolve(c));
    }
    if (typeof body.pasta === 'string' && body.pasta) {
      const pasta = path.resolve(body.pasta);
      if (!isWithinRoots(pasta, raizes())) return reply.code(403).send({ error: 'forbidden' });
      candidatos.push(...pdfsDaPasta(pasta));
    }
    if (!candidatos.length && !Array.isArray(body.caminhos) && typeof body.pasta !== 'string') {
      return reply.code(400).send({ error: 'caminhos_required' });
    }
    const categoria = categoriaLimpa(body.categoria);
    const agora = new Date().toISOString();
    const ids: string[] = [];
    let jaExistiam = 0;
    let recusados = 0;
    const existe = db.prepare('SELECT id FROM documentos WHERE caminho=?');
    const inserir = db.prepare(
      `INSERT INTO documentos (id, titulo, categoria, caminho, tamanho, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    transaction(db, () => {
      for (const c of new Set(candidatos)) {
        if (!ehPdf(c) || !isWithinRoots(c, raizes())) {
          recusados++;
          continue;
        }
        let tamanho: number;
        try {
          const st = fs.statSync(c);
          if (!st.isFile()) throw new Error('não é arquivo');
          tamanho = st.size;
        } catch {
          recusados++;
          continue;
        }
        if (existe.get(c)) {
          jaExistiam++;
          continue;
        }
        const id = randomUUID();
        inserir.run(id, cleanTitle(path.basename(c)), categoria, c, tamanho, agora, agora);
        ids.push(id);
      }
    });
    return reply.code(201).send({ criados: ids.length, jaExistiam, recusados, ids });
  });

  app.patch('/api/documentos/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const d = buscar(id);
    if (!d) return reply.code(404).send({ error: 'not_found' });
    const b = (req.body ?? {}) as { titulo?: unknown; categoria?: unknown; pagina?: unknown; paginas?: unknown; lido?: unknown };
    const agora = new Date().toISOString();
    const novo = { ...d };
    if (typeof b.titulo === 'string' && b.titulo.trim()) novo.titulo = b.titulo.trim().slice(0, 300);
    if ('categoria' in b) novo.categoria = categoriaLimpa(b.categoria);
    if (typeof b.paginas === 'number' && Number.isInteger(b.paginas) && b.paginas > 0) novo.paginas = b.paginas;
    let mexeuNaLeitura = false;
    if (typeof b.pagina === 'number' && Number.isInteger(b.pagina) && b.pagina >= 1) {
      novo.pagina = novo.paginas ? Math.min(b.pagina, novo.paginas) : b.pagina;
      mexeuNaLeitura = novo.pagina !== d.pagina || !d.leitura_em;
      // Chegar à última página conta como lido, como a aula que chega ao fim.
      if (novo.paginas && novo.pagina >= novo.paginas && !d.lido) {
        novo.lido = 1;
        novo.lido_em = agora;
      }
    }
    if (typeof b.lido === 'boolean') {
      novo.lido = b.lido ? 1 : 0;
      novo.lido_em = b.lido ? (d.lido ? d.lido_em : agora) : null;
      mexeuNaLeitura = true;
    }
    if (mexeuNaLeitura) novo.leitura_em = agora;
    db.prepare(
      `UPDATE documentos SET titulo=?, categoria=?, paginas=?, pagina=?, lido=?, lido_em=?, leitura_em=?, atualizado_em=? WHERE id=?`,
    ).run(novo.titulo, novo.categoria, novo.paginas, novo.pagina, novo.lido, novo.lido_em, novo.leitura_em, agora, id);
    return dto(buscar(id)!);
  });

  // Re-apontar: o PDF mudou de lugar, ou veio da conta e esta máquina ainda não
  // sabe onde ele está. A leitura continua a mesma.
  app.post('/api/documentos/:id/caminho', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!buscar(id)) return reply.code(404).send({ error: 'not_found' });
    const bruto = (req.body as { caminho?: unknown })?.caminho;
    if (typeof bruto !== 'string' || !bruto) return reply.code(400).send({ error: 'caminho_required' });
    const c = path.resolve(bruto);
    if (!ehPdf(c)) return reply.code(400).send({ error: 'nao-e-pdf' });
    if (!isWithinRoots(c, raizes())) return reply.code(403).send({ error: 'forbidden' });
    let tamanho: number;
    try {
      tamanho = fs.statSync(c).size;
    } catch {
      return reply.code(404).send({ error: 'file_missing' });
    }
    const outro = db.prepare('SELECT id FROM documentos WHERE caminho=? AND id<>?').get(c, id);
    if (outro) return reply.code(409).send({ error: 'ja-adicionado' });
    db.prepare('UPDATE documentos SET caminho=?, tamanho=?, atualizado_em=? WHERE id=?').run(c, tamanho, new Date().toISOString(), id);
    return dto(buscar(id)!);
  });

  app.delete('/api/documentos/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!buscar(id)) return reply.code(404).send({ error: 'not_found' });
    db.prepare('DELETE FROM documentos WHERE id=?').run(id);
    fs.rmSync(capaDe(id), { force: true });
    return reply.code(204).send();
  });

  app.get('/api/documentos/:id/arquivo', async (req, reply) => {
    const d = buscar((req.params as { id: string }).id);
    if (!d) return reply.code(404).send({ error: 'not_found' });
    // O caminho vem do banco, e o banco também é escrito pela descida da conta: a
    // mesma fronteira das aulas antes de abrir qualquer arquivo.
    if (!d.caminho || !ehPdf(d.caminho) || !isWithinRoots(d.caminho, raizes())) return reply.code(403).send({ error: 'forbidden' });
    return servirArquivo(req, reply, d.caminho, 'application/pdf');
  });

  app.get('/api/documentos/:id/capa', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const arquivo = capaDe(id);
    if (!fs.existsSync(arquivo)) return reply.code(404).send({ error: 'sem-capa' });
    reply.header('Cache-Control', 'no-cache');
    return reply.type('image/png').send(fs.readFileSync(arquivo));
  });

  app.put('/api/documentos/:id/capa', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!buscar(id)) return reply.code(404).send({ error: 'not_found' });
    const corpo = req.body;
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (!Buffer.isBuffer(corpo) || !corpo.subarray(0, 4).equals(PNG)) return reply.code(400).send({ error: 'nao-e-png' });
    fs.mkdirSync(config.thumbsDir, { recursive: true });
    fs.writeFileSync(capaDe(id), corpo);
    return reply.code(204).send();
  });
}
