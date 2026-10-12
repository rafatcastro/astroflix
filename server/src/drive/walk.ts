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
function nomear<T extends { nome: string; criado: string; id: string }>(itens: T[]): Map<T, string> {
  const ordenados = [...itens].sort(
    (a, b) => a.criado.localeCompare(b.criado) || a.id.localeCompare(b.id),
  );
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

  const visitar = async (id: string, prefixo: string): Promise<void> => {
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
