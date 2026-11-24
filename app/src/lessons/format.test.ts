import { describe, it, expect } from 'vitest';
import { formatDuration, formatClock, statusLabel, formatDay } from './format';

describe('format', () => {
  it('duração legível, sem esconder gravações curtas', () => {
    expect(formatDuration(8)).toBe('8 s');
    expect(formatDuration(181)).toBe('3 min 1 s');
    expect(formatDuration(3120)).toBe('52 min');
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
  it('dia em linguagem de gente', () => {
    const now = new Date(2026, 10, 24, 15);
    expect(formatDay(new Date(2026, 10, 24, 8).toISOString(), now)).toBe('Hoje');
    expect(formatDay(new Date(2026, 10, 23, 8).toISOString(), now)).toBe('Ontem');
    expect(formatDay(new Date(2026, 10, 19, 8).toISOString(), now)).toBe('19 nov');
    expect(formatDay(new Date(2025, 2, 3, 8).toISOString(), now)).toBe('3 mar 2025');
  });
});
