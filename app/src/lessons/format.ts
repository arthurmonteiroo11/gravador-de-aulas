import type { Lesson } from '../lib/types';

const pad = (n: number) => String(n).padStart(2, '0');

export const formatDuration = (s: number) => `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`;

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
