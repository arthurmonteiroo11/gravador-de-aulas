import { assertEquals } from 'jsr:@std/assert@1';
import { processStep, processUntilDone, type StepDeps, MAX_BLOCK_FAILURES } from './processStep.ts';
import { QuotaError, RateLimitError } from './gemini.ts';
import type { AudioChunk, LessonRow, ModelSegment, Segment } from './types.ts';

const chunk = (idx: number): AudioChunk => ({
  lesson_id: 'l', idx, start_s: idx * 60, duration_s: 60, path: `u/l/${idx}.m4a`, mime_type: 'audio/mp4',
});

function fakeDeps(lesson: Partial<LessonRow>, chunkCount: number, transcribe: () => Promise<ModelSegment[]>) {
  const state = {
    lesson: { id: 'l', status: 'processing', expected_chunks: chunkCount, processed_blocks: 0, total_blocks: null, block_failures: 0, recorded_at: '2026-11-24T10:00:00Z', duration_s: 600, ...lesson } as LessonRow & { error_message?: string },
    segments: new Map<number, Segment[]>(),
    outputs: null as null | { rewrite: string; summary: string },
    rewriteCalls: 0,
    leaseFree: true,
    released: 0,
    now: new Date('2026-11-24T10:30:00Z'),
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
    acquireLease: () => Promise.resolve(state.leaseFree),
    releaseLease: () => { state.released++; return Promise.resolve(); },
    now: () => state.now,
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

Deno.test(`bloco que falha ${MAX_BLOCK_FAILURES} vezes é pulado e a aula segue`, async () => {
  const { deps, state } = fakeDeps({ total_blocks: 2 }, 12, () => Promise.reject(new Error('quebrou')));
  for (let i = 0; i < MAX_BLOCK_FAILURES; i++) await processStep('l', deps);
  assertEquals(state.lesson.status, 'processing');
  assertEquals(state.lesson.processed_blocks, 1);
  assertEquals(state.segments.get(0), []);
  assertEquals(state.lesson.error_message, 'Não foi possível transcrever o trecho 00:00–10:00. Motivo: Error: quebrou');
});

Deno.test('outra chamada em andamento: não faz nada', async () => {
  let called = 0;
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => { called++; return ok(); });
  state.leaseFree = false;
  await processStep('l', deps);
  assertEquals(called, 0);
  assertEquals(state.lesson.processed_blocks, 0);
});

Deno.test('libera a vaga ao terminar, mesmo com erro', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => Promise.reject(new Error('x')));
  await processStep('l', deps);
  assertEquals(state.released, 1);
});

Deno.test('envio parado há mais de 2 h segue com as partes que chegaram', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 10 }, 9, ok);
  state.now = new Date('2026-11-24T12:11:00Z'); // gravação acabou 10:10
  await processStep('l', deps);
  assertEquals(state.lesson.status, 'processing');
  assertEquals(state.lesson.total_blocks, 1);
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

Deno.test('aula sem nenhuma parte depois do prazo vira erro em vez de ficar enviando', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 2 }, 0, () => Promise.resolve([]));
  deps.now = () => new Date('2026-11-24T13:00:00Z');
  await processStep('l', deps);
  assertEquals(state.lesson.status, 'error');
});

Deno.test('processUntilDone encadeia os passos até a aula ficar pronta', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 12 }, 12, ok);
  const r = await processUntilDone('l', deps, 100_000);
  assertEquals(r.status, 'ready');
  assertEquals(state.lesson.processed_blocks, 2);
  assertEquals(state.rewriteCalls, 1);
});

Deno.test('processUntilDone para quando não há avanço (esperando partes)', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 5 }, 2, ok);
  const r = await processUntilDone('l', deps, 100_000);
  assertEquals(r.status, 'uploading');
  assertEquals(state.lesson.status, 'uploading');
});

Deno.test('limite do Gemini aparece na aula e some quando o bloco passa', async () => {
  let calls = 0;
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () =>
    ++calls === 1 ? Promise.reject(new RateLimitError('Gemini ocupado (429)')) : ok());
  await processStep('l', deps);
  assertEquals(state.lesson.error_message, 'Aguardando o Gemini: Gemini ocupado (429)');
  await processStep('l', deps);
  assertEquals(state.lesson.error_message, null);
});

Deno.test('processUntilDone não começa outro passo depois do tempo limite', async () => {
  const { deps, state } = fakeDeps({ status: 'uploading', expected_chunks: 12 }, 12, ok);
  let t = 0;
  deps.now = () => new Date((t += 30_000));
  await processUntilDone('l', deps, 45_000);
  assertEquals(state.lesson.status, 'processing');
  assertEquals(state.lesson.processed_blocks, 0);
});

Deno.test('cota do Gemini esgotada encerra a aula com erro claro (dá para tentar de novo depois)', async () => {
  const { deps, state } = fakeDeps({ total_blocks: 1 }, 3, () => Promise.reject(new QuotaError('Sem cota')));
  await processStep('l', deps);
  assertEquals(state.lesson.status, 'error');
  assertEquals(state.lesson.error_message, 'Sem cota');
});
