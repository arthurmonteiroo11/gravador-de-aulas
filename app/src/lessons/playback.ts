import type { AudioChunk } from '../lib/types';

/** Converte um tempo da aula na parte de áudio e no ponto dentro dela. */
export function locate(chunks: AudioChunk[], t: number): { idx: number; offset: number } | null {
  for (const c of chunks) {
    if (t >= c.start_s && t < c.start_s + c.duration_s) return { idx: c.idx, offset: t - c.start_s };
  }
  return null;
}
