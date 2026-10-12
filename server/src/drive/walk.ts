import path from 'node:path';
import { VIDEO_EXTS, type ScannedFile } from '../scan/derive';
import { materialKind, type MaterialKind } from '../scan/walk';
import type { ArquivoDrive, ClienteDrive } from './api';
import { FalhaDrive } from './tipos';

export interface ArquivoRemoto extends ScannedFile {
  remoteId: string;
  thumbnailLink: string | null;
  durationSec: number | null;
}

export interface WalkDriveResult {
  titulo: string;
  videos: ArquivoRemoto[];
  materials: Array<ArquivoRemoto & { kind: MaterialKind }>;
}

const PASTA = 'application/vnd.google-apps.folder';
const ATALHO = 'application/vnd.google-apps.shortcut';

// Um nome do Drive pode ter '/' ou '\'. Sem trocar, "A/B" viraria dois
// segmentos no relPath e o curso ganharia um módulo que não existe.
const limpar = (nome: string): string => nome.replace(/[/\\]/g, '-');

// Dois itens com o mesmo nome na mesma pasta são válidos no Drive, mas o
// progresso é preso ao relPath: sem sufixo, duas aulas colidiriam. A ordem
// (createdTime, id) é estável entre re-escaneamentos, então cada aula mantém
// o mesmo relPath e o histórico não troca de dono.
// Comparação por code unit, não localeCompare: a ordem não pode depender do
// idioma da máquina nem da ordem em que a API devolveu a listagem.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ordem = (a: Item, b: Item): number =>
  cmp(a.criado, b.criado) || cmp(a.id, b.id) || cmp(a.nome, b.nome);

function nomear<T extends Item>(itens: T[]): Map<T, string> {
  const ordenados = [...itens].sort(ordem);
  const usados = new Set<string>();
  const saida = new Map<T, string>();
  for (const item of ordenados) {
    const ext = path.extname(item.nome);
    const base = item.nome.slice(0, item.nome.length - ext.length);
    let candidato = item.nome;
    for (let n = 2; usados.has(candidato.toLowerCase()); n++) candidato = `${base} (${n})${ext}`;
    usados.add(candidato.toLowerCase());
    saida.set(item, candidato);
  }
  return saida;
}

interface Item {
  nome: string; // já sanitizado; nome do atalho quando for atalho
  criado: string;
  id: string;
  arquivo: ArquivoDrive; // o alvo, quando for atalho
}

export async function walkDrive(cliente: ClienteDrive, pastaId: string): Promise<WalkDriveResult> {
  const raiz = await cliente.getArquivo(pastaId);
  if (raiz.mimeType !== PASTA) throw new FalhaDrive('nao-e-pasta');

  const videos: ArquivoRemoto[] = [];
  const materials: WalkDriveResult['materials'] = [];
  // Um atalho para um ancestral (ou duas pastas apontando uma para a outra)
  // faria a recursão nunca terminar; cada pasta é listada uma única vez.
  const visitadas = new Set<string>([raiz.id]);

  // Listar é a parte lenta (uma ida ao Google por pasta). As listagens correm
  // em paralelo, mas só a LISTAGEM: a montagem do resultado e a decisão de
  // "pasta já visitada" seguem a visita sequencial abaixo, na mesma ordem de
  // sempre. Se a deduplicação dependesse de qual listagem termina primeiro, o
  // relPath de uma pasta alcançável por real + atalho mudaria entre
  // re-escaneamentos e levaria o progresso junto.
  const SIMULTANEAS = 6;
  let ativas = 0;
  const espera: Array<() => void> = [];
  const vaga = async (): Promise<void> => {
    if (ativas < SIMULTANEAS) { ativas++; return; }
    await new Promise<void>((ok) => espera.push(ok));
  };
  const liberar = (): void => {
    const proximo = espera.shift();
    if (proximo) proximo(); // a vaga passa direto para quem esperava
    else ativas--;
  };

  interface Listagem { arquivos: Item[]; pastas: Item[] }
  const listagens = new Map<string, Promise<Listagem>>();

  const listar = async (id: string): Promise<Listagem> => {
    await vaga();
    try {
      return await listarEResolver(id);
    } finally {
      liberar();
    }
  };

  // Idempotente; ao terminar, já agenda as subpastas (fora da vaga, para a
  // recursão não prender um slot). Pasta que a visita sequencial acabar
  // pulando por duplicata é listada à toa, mas isso é só uma chamada a mais.
  const agendar = (id: string): Promise<Listagem> => {
    let p = listagens.get(id);
    if (!p) {
      p = listar(id);
      listagens.set(id, p);
      // Quem vai observar o erro é a visita; aqui só evita rejeição solta
      // quando a pasta nunca chega a ser visitada (outro erro abortou antes).
      p.then((l) => { for (const sub of l.pastas) agendar(sub.id); }, () => {});
    }
    return p;
  };

  const listarEResolver = async (id: string): Promise<Listagem> => {
    const filhos = await cliente.listarFilhos(id);
    const arquivos: Item[] = [];
    const pastas: Item[] = [];

    for (const f of filhos) {
      if (f.name.startsWith('.')) continue;
      let alvo = f;
      if (f.mimeType === ATALHO) {
        if (!f.shortcutDetails) continue;
        try {
          alvo = await cliente.getArquivo(f.shortcutDetails.targetId);
        } catch (e) {
          // Atalho para algo que a pessoa não pode abrir não deve derrubar o curso.
          if (e instanceof FalhaDrive && e.tipo === 'sem-acesso') continue;
          throw e;
        }
      }
      if (alvo.mimeType !== PASTA && alvo.mimeType.startsWith('application/vnd.google-apps.')) continue;
      const item: Item = {
        nome: limpar(f.name),
        criado: f.createdTime ?? '',
        id: alvo.id,
        arquivo: alvo,
      };
      (alvo.mimeType === PASTA ? pastas : arquivos).push(item);
    }
    return { arquivos, pastas };
  };

  const visitar = async (id: string, prefixo: string): Promise<void> => {
    const { arquivos, pastas } = await agendar(id);

    // Pasta alcançável por dois caminhos (real + atalho): quem chega primeiro
    // ganha o conteúdo, então a ordem de visita tem de ser determinística, ou o
    // relPath trocaria entre re-escaneamentos e levaria o progresso junto.
    pastas.sort(ordem);
    const nomesPastas = nomear(pastas);
    for (const p of pastas) {
      if (visitadas.has(p.id)) continue;
      visitadas.add(p.id);
      await visitar(p.id, `${prefixo}${nomesPastas.get(p)}/`);
    }

    const nomesArquivos = nomear(arquivos);
    for (const a of arquivos) {
      const relPath = `${prefixo}${nomesArquivos.get(a)}`;
      const d = a.arquivo;
      const base: ArquivoRemoto = {
        relPath,
        sizeBytes: Number(d.size ?? 0),
        mtime: d.modifiedTime ? Math.floor(Date.parse(d.modifiedTime)) : 0,
        remoteId: d.id,
        thumbnailLink: d.thumbnailLink ?? null,
        durationSec: d.videoMediaMetadata?.durationMillis
          ? Number(d.videoMediaMetadata.durationMillis) / 1000
          : null,
      };
      const ext = path.extname(a.nome).toLowerCase();
      if (VIDEO_EXTS.has(ext)) videos.push(base);
      else materials.push({ ...base, kind: materialKind(ext) });
    }
  };

  await visitar(raiz.id, '');
  return { titulo: raiz.name, videos, materials };
}
