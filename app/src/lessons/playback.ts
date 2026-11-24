import type { AudioChunk } from '../lib/types';

/** Converte um tempo da aula na parte de áudio e no ponto dentro dela. */
export function locate(chunks: AudioChunk[], t: number): { idx: number; offset: number } | null {
  for (const c of chunks) {
    if (t >= c.start_s && t < c.start_s + c.duration_s) return { idx: c.idx, offset: t - c.start_s };
  }
  return null;
}

/** Duração da aula inteira, pela soma das partes (o iPhone não grava a duração no arquivo). */
export function lessonLength(chunks: AudioChunk[]): number {
  return chunks.reduce((end, c) => Math.max(end, c.start_s + c.duration_s), 0);
}

/** Tempo da aula a partir da parte tocando e do ponto dentro dela. */
export function lessonTime(chunks: AudioChunk[], idx: number | null, offset: number): number {
  const c = idx === null ? undefined : chunks.find((x) => x.idx === idx);
  return c ? c.start_s + (Number.isFinite(offset) ? offset : 0) : 0;
}
