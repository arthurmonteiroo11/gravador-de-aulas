import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, formatCode, inviteLink, inviteOpen, newCode, normalizeCode } from './invites';

describe('convites', () => {
  it('código tem 10 letras do alfabeto sem letras confusas', () => {
    const code = newCode();
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{10}$`));
    expect(newCode(() => new Uint8Array(10).fill(255))).toBe('9999999999');
  });

  it('formata, lê de volta e monta o link', () => {
    expect(formatCode('K7QM4XPA2B')).toBe('K7QM-4XPA-2B');
    expect(normalizeCode(' k7qm-4xpa-2b ')).toBe('K7QM4XPA2B');
    expect(normalizeCode('K7QM4XPA2O')).toBeNull();
    expect(inviteLink('K7QM4XPA2B', 'https://aulas.app')).toBe('https://aulas.app/?convite=K7QM4XPA2B');
  });

  it('aberto só enquanto não foi usado nem venceu', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(inviteOpen({ code: 'x', created_at: '', expires_at: '2026-11-30T00:00:00Z', used_at: null }, now)).toBe(true);
    expect(inviteOpen({ code: 'x', created_at: '', expires_at: '2026-11-20T00:00:00Z', used_at: null }, now)).toBe(false);
    expect(inviteOpen({ code: 'x', created_at: '', expires_at: '2026-11-30T00:00:00Z', used_at: '2026-11-24T00:00:00Z' }, now)).toBe(false);
  });
});
