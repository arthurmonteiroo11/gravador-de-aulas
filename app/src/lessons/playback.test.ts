import { describe, it, expect } from 'vitest';
import { locate } from './playback';

const chunks = [0, 1, 2].map((idx) => ({ lesson_id: 'l', idx, start_s: idx * 60, duration_s: 60, path: `p/${idx}` }));

describe('locate', () => {
  it('acha a parte e o deslocamento', () => {
    expect(locate(chunks, 125)).toEqual({ idx: 2, offset: 5 });
    expect(locate(chunks, 0)).toEqual({ idx: 0, offset: 0 });
  });
  it('tempo além do fim dá null', () => {
    expect(locate(chunks, 181)).toBeNull();
  });
  it('funciona com partes curtas por causa de pausas', () => {
    const c = [
      { lesson_id: 'l', idx: 0, start_s: 0, duration_s: 30, path: 'a' },
      { lesson_id: 'l', idx: 1, start_s: 30, duration_s: 60, path: 'b' },
    ];
    expect(locate(c, 45)).toEqual({ idx: 1, offset: 15 });
  });
});
