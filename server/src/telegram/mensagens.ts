import path from 'node:path';
import { VIDEO_EXTS, cleanTitle, type ScannedFile } from '../scan/derive';
import { materialKind, type MaterialKind } from '../scan/walk';
import type { MensagemTelegram } from './tipos';

export interface ArquivoTelegram extends ScannedFile {
  /** O id da mensagem — o endereço para baixar, nunca a identidade da aula. */
  remoteId: string;
  titulo: string;
  durationSec: number | null;
  temMiniatura: boolean;
}

export interface CursoTelegram {
  videos: ArquivoTelegram[];
  materials: Array<ArquivoTelegram & { kind: MaterialKind }>;
}

const EXT_DO_MIME: Record<string, string> = {
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi', 'video/mpeg': '.mpg', 'application/pdf': '.pdf', 'application/zip': '.zip',
};

// Um nome com '/' ou '\' viraria dois segmentos no relPath, e o curso ganharia
// um módulo que não existe (mesma regra do Drive).
const limpar = (nome: string): string => nome.replace(/[/\\]/g, '-').trim();

function comExtensao(nome: string | null, mime: string, padrao: string): string {
  const base = nome ? limpar(nome) : '';
  if (base && path.extname(base)) return base;
  const ext = EXT_DO_MIME[mime] ?? '';
  return `${base || padrao}${ext}`;
}

function ehVideo(nome: string, mime: string): boolean {
  return mime.startsWith('video/') || VIDEO_EXTS.has(path.extname(nome).toLowerCase());
}

const dataCurta = (seg: number): string => {
  const d = new Date(seg * 1000);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

/**
 * As mensagens do grupo viram aulas e materiais. O relPath começa pelo id da
 * mensagem com 10 dígitos: o id cresce na ordem de postagem, então a ordenação
 * natural do deriveCourse dá a ordem do grupo — e o id não muda entre
 * re-escaneamentos, então o progresso nunca troca de aula.
 */
export function montarCurso(mensagens: MensagemTelegram[]): CursoTelegram {
  const videos: ArquivoTelegram[] = [];
  const materials: CursoTelegram['materials'] = [];

  for (const m of [...mensagens].sort((a, b) => a.id - b.id)) {
    const midia = m.midia;
    if (!midia || midia.tipo === 'outro') continue;
    const prefixo = String(m.id).padStart(10, '0');
    const nome = midia.tipo === 'foto' ? 'foto.jpg' : comExtensao(midia.nome, midia.mime, midia.tipo === 'video' ? 'video' : 'arquivo');
    const base = {
      relPath: `${prefixo}-${nome}`,
      sizeBytes: midia.tamanho,
      mtime: m.data * 1000,
      remoteId: String(m.id),
      durationSec: midia.duracaoSec,
      temMiniatura: midia.temMiniatura,
    };

    // Foto entra na lista junto com os vídeos, na ordem de postagem: em canal de
    // conteúdo, ela é parte do que se vê, não material de apoio.
    if (midia.tipo === 'foto' || midia.tipo === 'video' || ehVideo(nome, midia.mime)) {
      const legenda = m.legenda.split('\n')[0]?.trim() ?? '';
      const padrao = midia.tipo === 'foto' ? `Foto de ${dataCurta(m.data)}` : `Vídeo de ${dataCurta(m.data)}`;
      const titulo = legenda || (midia.nome ? cleanTitle(limpar(midia.nome)) : '') || padrao;
      videos.push({ ...base, titulo: titulo.slice(0, 200) });
    } else {
      materials.push({ ...base, titulo: nome, kind: materialKind(path.extname(nome)) });
    }
  }
  return { videos, materials };
}
