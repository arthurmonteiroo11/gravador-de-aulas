import { assert, assertEquals } from 'jsr:@std/assert@1';
import { combinePrompt, fallbackTitle, MAX_CHARS_PER_LESSON } from './combine.ts';

const a = { title: 'Derivadas', subject: 'Cálculo I', recorded_at: '2026-11-06T11:00:00Z', text: 'texto B' };
const b = { title: 'Limites', subject: 'Cálculo I', recorded_at: '2026-11-05T11:00:00Z', text: 'texto A' };

Deno.test('coloca as aulas em ordem de data', () => {
  const p = combinePrompt([a, b]);
  assert(p.indexOf('Aula 1: Limites') < p.indexOf('Aula 2: Derivadas'));
  assert(p.includes('5 de novembro'));
});

Deno.test('corta textos longos demais', () => {
  const p = combinePrompt([{ ...a, text: 'Ω'.repeat(MAX_CHARS_PER_LESSON + 500) }]);
  assertEquals((p.match(/Ω/g) ?? []).length, MAX_CHARS_PER_LESSON);
});

Deno.test('título padrão usa a matéria quando é uma só', () => {
  assertEquals(fallbackTitle([a, b]), 'Cálculo I: 2 aulas');
  assertEquals(fallbackTitle([a, { ...b, subject: 'Física' }]), 'Resumo de 2 aulas');
});
