import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { contextNote, parseTerms } from './context.ts';

Deno.test('separa termos por vírgula, ponto e vírgula e linha, sem repetidos', () => {
  assertEquals(parseTerms(' Bhaskara, derivada;\n\nregra de L’Hôpital\nderivada ,  limite  lateral '), ['Bhaskara', 'derivada', 'regra de L’Hôpital', 'limite lateral']);
  assertEquals(parseTerms(null), []);
});

Deno.test('contexto com matéria e termos', () => {
  const note = contextNote('Cálculo I', 'derivada, Bhaskara');
  assertStringIncludes(note, 'Matéria: Cálculo I.');
  assertStringIncludes(note, 'derivada; Bhaskara');
});

Deno.test('sem matéria nem termos, nada é enviado', () => {
  assertEquals(contextNote(null, ''), '');
  assertEquals(contextNote('  ', ' , ;'), '');
  assertEquals(contextNote('História', '').includes('Termos'), false);
});
