import { assert, assertEquals } from 'jsr:@std/assert@1';
import { cleanCards, flashcardsPrompt, MAX_FLASHCARD_CHARS } from './flashcards.ts';

Deno.test('cleanCards tira vazios e repetidos', () => {
  const cards = cleanCards([
    { front: ' O que é derivada? ', back: 'Taxa de variação.' },
    { front: 'o que é derivada?', back: 'Repetida.' },
    { front: '', back: 'x' },
    { front: 'Sem verso', back: '  ' },
    'lixo',
  ]);
  assertEquals(cards, [{ front: 'O que é derivada?', back: 'Taxa de variação.' }]);
});

Deno.test('cleanCards aceita resposta que não é lista', () => {
  assertEquals(cleanCards(null), []);
});

Deno.test('flashcardsPrompt corta material longo', () => {
  const p = flashcardsPrompt('Aula', 'Ω'.repeat(MAX_FLASHCARD_CHARS + 10));
  assertEquals((p.match(/Ω/g) ?? []).length, MAX_FLASHCARD_CHARS);
  assert(p.includes('# Aula'));
});
