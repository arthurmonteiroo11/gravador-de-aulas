import { assertEquals } from 'jsr:@std/assert@1';
import { processStep, type StepDeps, MAX_BLOCK_FAILURES } from './processStep.ts';
import { RateLimitError } from './gemini.ts';
import type { AudioChunk, LessonRow, ModelSegment, Segment } from './types.ts';

const chunk = (idx: number): AudioChunk => ({
  lesson_id: 'l', idx, start_s: idx * 60, duration_s: 60, path: `u/l/${idx}.m4a`, mime_type: 'audio/mp4',
});

function fakeDeps(lesson: Partial<LessonRow>, chunkCount: number, transcribe: () => Promise<ModelSegment[]>) {
  const state = {
    lesson: { id: 'l', status: 'processing', expected_chunks: chunkCount, processed_blocks: 0, total_blocks: null, block_failures: 0, ...lesson } as LessonRow & { error_message?: string },
    segments: new Map<number, Segment[]>(),
    outputs: null as null | { rewrite: string; summary: string },
    rewriteCalls: 0,
  };
  const chunks = Array.from({ length: chunkCount }, (_, i) => chunk(i));
  const deps: StepDeps = {
    getLesson: () => Promise.resolve({ ...state.lesson }),
    updateLesson: (patch) => { Object.assign(state.lesson, patch); return Promise.resolve(); },
    listChunks: () => Promise.resolve(chunks),
    download: () => Promise.resolve(new Uint8Array([0])),
    replaceSegments: (block, segs) => { state.segments.set(block, segs); return Promise.resolve(); },
    listSegments: () => Promise.resolve([...state.segments.values()].flat()),
    saveOutputs: (o) => { state.outputs = o; return Promise.resolve(); },
    transcribe,
    rewrite: () => { state.rewriteCalls++; return Promise.resolve({ rewrite: '# R', summary: '- S' }); },
    model: 'm',
  };
  return { deps, state };
}

const ok = () => Promise.resolve([{ part: 0, start: 1, end: 2, text: 'fala' }]);

Deno.test('espera todas as partes chegarem antes de processar', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 5 }, 3, ok);
  assertEquals((await processStep('l', deps)).status, 'uploading');
  assertEquals(state.lesson.status, 'uploading');
});

Deno.test('com todas as partes, começa a processar e calcula os blocos', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 12 }, 12, ok);
  await processStep('l', deps);
  assertEquals(state.lesson.status, 'processing');
  assertEquals(state.lesson.total_blocks, 2);
});

Deno.test('aula sem nenhuma parte vira erro', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 0 }, 0, ok);
  await processStep('l', deps);
  assertEquals(state.lesson.status, 'error');
});

Deno.test('um passo processa um bloco e grava tempos absolutos', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 2 }, 12, ok);
  await processStep('l', deps);
  await processStep('l', deps);
  assertEquals(state.lesson.processed_blocks, 2);
  assertEquals(state.segments.get(1)?.[0].start_s, 601);
});

Deno.test('bloco em silêncio não falha a aula', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => Promise.resolve([]));
  await processStep('l', deps);
  assertEquals(state.lesson.processed_blocks, 1);
  assertEquals(state.lesson.status, 'processing');
});

Deno.test('limite do Gemini deixa o bloco pendente sem contar falha', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => Promise.reject(new RateLimitError('429')));
  assertEquals((await processStep('l', deps)).status, 'processing');
  assertEquals(state.lesson.processed_blocks, 0);
  assertEquals(state.lesson.block_failures, 0);
});

Deno.test(`erro repetido ${MAX_BLOCK_FAILURES} vezes vira erro`, async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => Promise.reject(new Error('quebrou')));
  for (let i = 0; i < MAX_BLOCK_FAILURES; i++) await processStep('l', deps);
  assertEquals(state.lesson.status, 'error');
});

Deno.test('com todos os blocos prontos, gera reescrita e resumo', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, ok);
  await processStep('l', deps);
  const res = await processStep('l', deps);
  assertEquals(res.status, 'ready');
  assertEquals(state.outputs, { rewrite: '# R', summary: '- S' });
});

Deno.test('aula toda em silêncio fica pronta sem chamar a IA', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => Promise.resolve([]));
  await processStep('l', deps);
  await processStep('l', deps);
  assertEquals(state.lesson.status, 'ready');
  assertEquals(state.rewriteCalls, 0);
  assertEquals(state.outputs?.summary, 'Nenhuma fala detectada nesta gravação.');
});
