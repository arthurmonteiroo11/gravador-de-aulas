import { describe, it, expect } from 'vitest';
import { retryPatch } from './retry';

describe('retryPatch', () => {
  it('aula com erro na reescrita volta a processar', () => {
    expect(retryPatch({ status: 'error', total_blocks: 9 })).toEqual({ status: 'processing', block_failures: 0, error_message: null });
  });
  it('aula com erro antes de começar volta a esperar o envio', () => {
    expect(retryPatch({ status: 'error', total_blocks: null })).toEqual({ status: 'uploading', block_failures: 0, error_message: null });
  });
  it('aula sem erro não muda', () => {
    expect(retryPatch({ status: 'ready', total_blocks: 9 })).toBeNull();
  });
});

import { isWaitingForGemini, retranscribePatch } from './retry';
describe('transcrever de novo', () => {
  it('recomeça do bloco 0 com o total certo', () => {
    expect(retranscribePatch(23)).toEqual({ status: 'processing', total_blocks: 3, processed_blocks: 0, block_failures: 0, error_message: null });
  });
  it('"Tentar agora" só quando está esperando o Gemini', () => {
    expect(isWaitingForGemini({ status: 'processing', error_message: 'Aguardando o Gemini: todos os modelos' })).toBe(true);
    expect(isWaitingForGemini({ status: 'processing', error_message: null })).toBe(false);
    expect(isWaitingForGemini({ status: 'ready', error_message: 'Aguardando o Gemini' })).toBe(false);
  });
});
