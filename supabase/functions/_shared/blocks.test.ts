import { assertEquals } from 'jsr:@std/assert@1';
import { groupIntoBlocks, toAbsoluteSegments, BLOCK_SIZE } from './blocks.ts';
import type { AudioChunk } from './types.ts';

const chunk = (idx: number, start_s = idx * 60): AudioChunk => ({
  lesson_id: 'l', idx, start_s, duration_s: 60, path: `u/l/${idx}.m4a`, mime_type: 'audio/mp4',
});

Deno.test('blocos de 10 partes em ordem', () => {
  const chunks = [12, 0, 5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11].map((i) => chunk(i));
  const blocks = groupIntoBlocks(chunks);
  assertEquals(BLOCK_SIZE, 10);
  assertEquals(blocks.map((b) => b.map((c) => c.idx)), [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12]]);
});

Deno.test('toAbsoluteSegments soma o início da parte', () => {
  const block = [chunk(10, 600), chunk(11, 660)];
  assertEquals(toAbsoluteSegments(block, [{ part: 1, start: 5, end: 9, text: 'Olá' }]), [
    { start_s: 665, end_s: 669, text: 'Olá', speaker: null },
  ]);
});

Deno.test('bloco em silêncio dá lista vazia', () => {
  assertEquals(toAbsoluteSegments([chunk(0)], []), []);
});

Deno.test('descarta part inválido e texto vazio, ordena por tempo', () => {
  const block = [chunk(0), chunk(1)];
  const out = toAbsoluteSegments(block, [
    { part: 12, start: 0, end: 1, text: 'fora' },
    { part: 1, start: 0, end: 2, text: 'b' },
    { part: 0, start: 3, end: 4, text: '   ' },
    { part: 0, start: 1, end: 2, text: 'a' },
  ]);
  assertEquals(out.map((s) => s.text), ['a', 'b']);
});

Deno.test('tempo além da parte é limitado à duração dela', () => {
  const out = toAbsoluteSegments([chunk(0)], [{ part: 0, start: 58, end: 75, text: 'x' }]);
  assertEquals(out[0].end_s, 60);
});
