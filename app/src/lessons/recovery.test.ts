import { describe, it, expect } from 'vitest';
import { summarizeChunks } from './recovery';

describe('summarizeChunks', () => {
  it('junta partes do aparelho e da nuvem sem contar repetidas', () => {
    const local = [{ idx: 2, durationS: 30 }];
    const remote = [{ idx: 0, duration_s: 60 }, { idx: 1, duration_s: 60 }, { idx: 2, duration_s: 30 }];
    expect(summarizeChunks(local, remote)).toEqual({ chunkCount: 3, durationS: 150 });
  });
  it('sem partes', () => {
    expect(summarizeChunks([], [])).toEqual({ chunkCount: 0, durationS: 0 });
  });
});
