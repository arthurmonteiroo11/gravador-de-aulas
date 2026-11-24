import { describe, it, expect } from 'vitest';
import { allPages, PAGE } from './content';

describe('allPages', () => {
  it('busca todas as páginas de uma aula longa', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const asked: [number, number][] = [];
    const got = await allPages((from, to) => {
      asked.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    });
    expect(got).toEqual(rows);
    expect(asked).toEqual([[0, PAGE - 1], [PAGE, 2 * PAGE - 1], [2 * PAGE, 3 * PAGE - 1]]);
  });
  it('erro no meio não devolve aula pela metade', async () => {
    await expect(allPages((from) => Promise.resolve(from ? { data: null, error: new Error('x') } : { data: Array(PAGE).fill(0), error: null }))).rejects.toThrow('x');
  });
});
