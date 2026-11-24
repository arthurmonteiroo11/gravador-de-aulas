import { describe, it, expect } from 'vitest';
import { describeLoadError } from './errors';

describe('describeLoadError', () => {
  it('diz sem conexão quando a rede falha', () => {
    expect(describeLoadError(new TypeError('Load failed'))).toBe('Sem conexão. Mostrando quando a internet voltar.');
  });

  it('mostra a mensagem e o código do servidor', () => {
    expect(describeLoadError({ message: 'permission denied for table lessons', code: '42501' })).toBe(
      'Erro do servidor: permission denied for table lessons (42501)',
    );
  });

  it('mostra só a mensagem quando não há código', () => {
    expect(describeLoadError({ message: 'Invalid API key' })).toBe('Erro do servidor: Invalid API key');
  });
});
