import { describe, it, expect } from 'vitest';
import { errorText, recordProblem, lastProblems } from './diagnostics';

describe('diagnostics', () => {
  it('lê status e corpo da resposta de uma função', async () => {
    const err = { message: 'Edge Function returned a non-2xx status code', context: new Response('{"error":"sem chave"}', { status: 500 }) };
    expect(await errorText(err)).toBe('500 {"error":"sem chave"}');
  });

  it('usa mensagem e código nos outros erros', async () => {
    expect(await errorText({ message: 'new row violates row-level security policy', code: '42501' })).toBe(
      'new row violates row-level security policy (42501)',
    );
    expect(await errorText(new Error('Load failed'))).toBe('Load failed');
  });

  it('guarda o último problema de cada tipo e limpa quando dá certo', () => {
    recordProblem('upload', 'rede');
    expect(lastProblems().upload).toBe('rede');
    recordProblem('upload', null);
    expect(lastProblems().upload).toBeNull();
  });
});
