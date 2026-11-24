import type { Lesson } from '../lib/types';

const pad = (n: number) => String(n).padStart(2, '0');

export const formatDuration = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m >= 10) return `${m} min`;
  if (m > 0) return `${m} min ${t % 60} s`;
  return `${t} s`;
};

export const formatClock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(t % 60)}` : `${pad(m)}:${pad(t % 60)}`;
};

export const statusLabel = (l: Pick<Lesson, 'status' | 'processed_blocks' | 'total_blocks'>) => {
  switch (l.status) {
    case 'recording': return 'Gravando';
    case 'uploading': return 'Enviando';
    case 'processing': return l.total_blocks ? `Transcrevendo ${l.processed_blocks}/${l.total_blocks}` : 'Transcrevendo';
    case 'ready': return 'Pronta';
    case 'error': return 'Erro';
  }
};

/** "Hoje", "Ontem" ou "24 nov"; ano só quando não é o atual. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) };
  return d.toLocaleDateString('pt-BR', opts).replace('.', '').replace(/ de /g, ' ');
}
