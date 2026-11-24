import { describe, it, expect } from 'vitest';
import { formatDuration, formatClock, statusLabel } from './format';

describe('format', () => {
  it('duração legível, sem esconder gravações curtas', () => {
    expect(formatDuration(8)).toBe('8 s');
    expect(formatDuration(181)).toBe('3 min 1 s');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });
  it('relógio mm:ss e h:mm:ss', () => {
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });
  it('status em português', () => {
    expect(statusLabel({ status: 'processing', processed_blocks: 2, total_blocks: 9 })).toBe('Transcrevendo 2/9');
    expect(statusLabel({ status: 'ready', processed_blocks: 9, total_blocks: 9 })).toBe('Pronta');
  });
});
