import { describe, it, expect } from 'vitest';
import { cleanName, folderTaken, mergeFolders } from './folders';

describe('pastas', () => {
  it('limpa espaços do nome', () => expect(cleanName('  Química   Orgânica ')).toBe('Química Orgânica'));
  it('junta as salvas com as das aulas, sem repetir', () =>
    expect(mergeFolders(['Física', 'Cálculo I'], [{ subject: 'Cálculo I' }, { subject: null }, { subject: ' Biologia ' }])).toEqual(['Biologia', 'Cálculo I', 'Física']));
  it('não deixa renomear para uma pasta que já existe', () => {
    expect(folderTaken('química', 'Física', ['Física', 'Química'])).toBe(true);
    expect(folderTaken('física', 'Física', ['Física', 'Química'])).toBe(false);
    expect(folderTaken('Biologia', 'Física', ['Física', 'Química'])).toBe(false);
  });
});

import { termCount } from './folders';
describe('termos', () => {
  it('conta termos sem repetir', () => expect(termCount('derivada, Derivada;\nlimite\n\n , integral')).toBe(3));
});
