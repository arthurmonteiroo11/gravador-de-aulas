import { describe, expect, it } from 'vitest';
import { combineError } from './study';

const httpError = (body: unknown) => ({ context: { json: async () => body } });

describe('combineError', () => {
  it('mostra a frase de erro do servidor', async () => {
    expect(await combineError(httpError({ error: 'A aula "Limites" ainda não tem texto.' }))).toBe('A aula "Limites" ainda não tem texto.');
  });
  it('sem resposta do servidor, fala da internet', async () => {
    expect(await combineError(new Error('Failed to fetch'))).toMatch(/Verifique a internet/);
    expect(await combineError({ context: { json: async () => { throw new Error('x'); } } })).toMatch(/Verifique a internet/);
  });
});
