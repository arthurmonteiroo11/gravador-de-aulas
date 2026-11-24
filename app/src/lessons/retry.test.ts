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
