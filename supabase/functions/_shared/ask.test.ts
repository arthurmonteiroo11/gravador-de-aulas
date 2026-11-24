import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { askMaterial, askPrompt, cleanAnswer, parseClock } from './ask.ts';

const lessons = [
  { id: 'l1', title: 'Revolução Industrial', recorded_at: '2026-11-21T13:00:00Z', segments: [{ start_s: 0, text: 'Bom dia.' }, { start_s: 64.4, text: 'A máquina a vapor de James Watt.' }, { start_s: 131, text: 'Consequências sociais.' }] },
  { id: 'l2', title: 'Segunda Revolução', recorded_at: '2026-11-22T13:00:00Z', segments: [{ start_s: 3725, text: 'Aço e petróleo.' }] },
];

Deno.test('material com etiqueta de aula e tempo em cada linha', () => {
  const m = askMaterial(lessons);
  assertStringIncludes(m, '[A1 01:04] A máquina a vapor de James Watt.');
  assertStringIncludes(m, '[A2 1:02:05] Aço e petróleo.');
  assertStringIncludes(m, '### A2: Segunda Revolução');
});

Deno.test('teto de caracteres é dividido entre as aulas', () => {
  const long = { ...lessons[0], segments: Array.from({ length: 1000 }, (_, i) => ({ start_s: i * 5, text: 'x'.repeat(90) })) };
  const m = askMaterial([long, long], 20_000);
  assert(m.length < 21_000, `material grande demais: ${m.length}`);
  assertEquals(m.split('### ').length - 1, 2);
});

Deno.test('pergunta leva só as últimas 4 trocas da conversa', () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ q: `pergunta ${i}`, a: `resposta ${i}` }));
  const p = askPrompt(lessons, 'O que caiu?', history);
  assert(!p.includes('pergunta 1'));
  assertStringIncludes(p, 'pergunta 5');
  assertStringIncludes(p, 'O que caiu?');
});

Deno.test('lê tempos em mm:ss e h:mm:ss', () => {
  assertEquals(parseClock('01:04'), 64);
  assertEquals(parseClock('1:02:05'), 3725);
  assertEquals(parseClock('ontem'), null);
});

Deno.test('fontes: aula certa, tempo ajustado ao trecho e inválidas fora', () => {
  const a = cleanAnswer({
    answer: 'A máquina a vapor [1] e o aço [2].',
    sources: [
      { n: 2, lesson: 'A2', time: '1:02:05', quote: 'Aço e petróleo.' },
      { n: 1, lesson: 'A1', time: '01:10', quote: 'máquina a vapor' },
      { n: 3, lesson: 'A9', time: '00:10', quote: 'inventada' },
      { n: 1, lesson: 'A1', time: '00:00', quote: 'repetida' },
    ],
  }, lessons);
  assertEquals(a.sources.map((s) => [s.n, s.lessonId, s.startS]), [[1, 'l1', 64.4], [2, 'l2', 3725]]);
  assertEquals(a.sources[0].title, 'Revolução Industrial');
});

Deno.test('resposta vazia não quebra', () => {
  assertEquals(cleanAnswer(null, lessons), { answer: '', sources: [] });
});

Deno.test('aula grande demais: vão trechos do começo ao fim, com aviso', () => {
  const long = { ...lessons[0], segments: Array.from({ length: 1000 }, (_, i) => ({ start_s: i * 5, text: 'y'.repeat(90) })) };
  const m = askMaterial([long], 20_000);
  assertStringIncludes(m, 'trechos espaçados');
  const times = [...m.matchAll(/\[A1 ([\d:]+)\]/g)].map((x) => x[1]);
  assert(times.length > 50);
  assert(times[times.length - 1] >= '1:20:00', `não chegou ao fim da aula: ${times[times.length - 1]}`);
});
