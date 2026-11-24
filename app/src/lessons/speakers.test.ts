import { describe, expect, it } from 'vitest';
import { cleanNames, manySpeakers, speakerChanges, speakerList, speakerName } from './speakers';

const segs = [{ speaker: 'Professor' }, { speaker: 'Aluno 1' }, { speaker: 'Aluno 1' }, { speaker: null }, { speaker: 'Professor' }];

describe('quem fala', () => {
  it('lista na ordem em que aparecem e marca só a troca', () => {
    expect(speakerList(segs)).toEqual(['Professor', 'Aluno 1']);
    expect(manySpeakers(segs)).toBe(true);
    expect(manySpeakers([{ speaker: 'Professor' }, { speaker: null }])).toBe(false);
    expect(speakerChanges(segs)).toEqual([true, true, false, false, true]);
  });

  it('nome dado pela pessoa substitui o rótulo; vazio volta ao rótulo', () => {
    expect(speakerName('Aluno 1', { 'Aluno 1': 'Bia' })).toBe('Bia');
    expect(speakerName('Aluno 1', { 'Aluno 1': ' ' })).toBe('Aluno 1');
    expect(cleanNames({ Professor: 'Professor', 'Aluno 1': '  Bia  Souza ', Outro: 'x' }, ['Professor', 'Aluno 1'])).toEqual({ 'Aluno 1': 'Bia Souza' });
  });
});
