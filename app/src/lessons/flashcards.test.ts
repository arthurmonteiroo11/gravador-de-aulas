import { describe, expect, it } from 'vitest';
import { nextReview } from './flashcards';

const now = new Date('2026-11-24T12:00:00Z');
const daysAfter = (iso: string) => Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);

describe('nextReview', () => {
  it('acertou: sobe uma caixa e espaça mais', () => {
    expect(nextReview(1, true, now).box).toBe(2);
    expect(daysAfter(nextReview(1, true, now).due_at)).toBe(3);
    expect(daysAfter(nextReview(3, true, now).due_at)).toBe(14);
  });
  it('não passa da caixa 5', () => {
    const r = nextReview(5, true, now);
    expect(r.box).toBe(5);
    expect(daysAfter(r.due_at)).toBe(30);
  });
  it('errou: volta para a caixa 1 e revisa amanhã', () => {
    const r = nextReview(4, false, now);
    expect(r.box).toBe(1);
    expect(daysAfter(r.due_at)).toBe(1);
  });
});
