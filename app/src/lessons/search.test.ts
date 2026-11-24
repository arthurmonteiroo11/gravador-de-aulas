import { describe, it, expect } from 'vitest';
import { snippetAround, likePattern, filterLessons, subjectsOf, splitMatches } from './search';

const lesson = (title: string, subject: string | null) => ({ title, subject });

describe('busca', () => {
  it('recorta um trecho em volta da palavra, sem cortar no meio', () => {
    const text = 'A primeira pergunta é: por que a Revolução Industrial começou na Inglaterra e não em outro lugar?';
    expect(snippetAround(text, 'inglaterra', 20)).toBe('…começou na Inglaterra e não em outro…');
  });

  it('trecho curto volta inteiro', () => {
    expect(snippetAround('carvão e ferro', 'ferro', 40)).toBe('carvão e ferro');
  });

  it('escapa os curingas do banco', () => {
    expect(likePattern('100%_certo')).toBe('%100\\%\\_certo%');
  });

  it('filtra por matéria e por título, ignorando maiúsculas e acentos', () => {
    const all = [lesson('Derivadas', 'Cálculo I'), lesson('Genética', 'Biologia'), lesson('Limites', 'Cálculo I')];
    expect(filterLessons(all, { subject: 'Cálculo I', query: '' }).map((l) => l.title)).toEqual(['Derivadas', 'Limites']);
    expect(filterLessons(all, { subject: null, query: 'genetica' }).map((l) => l.title)).toEqual(['Genética']);
    expect(filterLessons(all, { subject: null, query: 'calculo' }).map((l) => l.title)).toEqual(['Derivadas', 'Limites']);
  });

  it('lista as matérias sem repetir, em ordem alfabética', () => {
    expect(subjectsOf([lesson('a', 'História'), lesson('b', null), lesson('c', 'Biologia'), lesson('d', 'História')])).toEqual([
      'Biologia',
      'História',
    ]);
  });

  it('separa o texto para destacar o que foi buscado', () => {
    expect(splitMatches('O vapor e a Máquina a Vapor', 'vapor')).toEqual([
      { text: 'O ', hit: false },
      { text: 'vapor', hit: true },
      { text: ' e a Máquina a ', hit: false },
      { text: 'Vapor', hit: true },
    ]);
    expect(splitMatches('sem nada', '')).toEqual([{ text: 'sem nada', hit: false }]);
  });
});
