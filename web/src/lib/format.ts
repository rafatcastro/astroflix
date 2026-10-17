export function formatDuration(totalSec: number | null | undefined): string {
  if (!totalSec || totalSec <= 0) return '--:--';
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** Tempo que falta, arredondado para o que importa: "faltam 40 s", "faltam 12 min", "faltam 2 h 5 min". */
export function formatRestante(seg: number): string {
  if (!isFinite(seg) || seg < 0) return '';
  if (seg < 60) return `faltam ${Math.max(1, Math.round(seg))} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `faltam ${min} min`;
  const h = Math.floor(min / 60);
  return `faltam ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Tamanho de arquivo em pt-BR: "850 MB", "12,3 GB". */
export function formatBytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024)).toLocaleString('pt-BR')} KB`;
  if (n < 1024 ** 3) return `${Math.round(n / 1024 ** 2).toLocaleString('pt-BR')} MB`;
  return `${(n / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
}
