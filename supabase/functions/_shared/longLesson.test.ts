/**
 * Simulação de uma aula de 1h30: 90 partes de 1 min, 9 blocos de transcrição e a reescrita.
 * O relógio é falso: cada chamada ao Gemini "demora" o tempo típico, e a função é chamada
 * como na vida real (pela tela da aula a cada 15 s e pelo agendador a cada 5 min).
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { processUntilDone, type StepDeps } from './processStep.ts';
import { RateLimitError } from './gemini.ts';
import { BLOCK_SIZE } from './blocks.ts';
import type { AudioChunk, AudioPart, LessonRow, Segment } from './types.ts';

const FUNCTION_LIMIT_MS = 150_000;
const MINUTES = 90;
const SEGMENTS_PER_MINUTE = 14; // professor falando rápido, trechos curtos: passa de 1000 linhas

function simulate(opts: { transcribeMs: number; rewriteMs: number; partBytes: number; busyBlocks?: number[]; failOnce?: number[] }) {
  let clock = Date.parse('2026-11-24T12:00:00Z');
  const chunks: AudioChunk[] = Array.from({ length: MINUTES }, (_, i) => ({
    lesson_id: 'l', idx: i, start_s: i * 60, duration_s: 60, path: `u/l/${i}.m4a`, mime_type: 'audio/mp4',
  }));
  const lesson = {
    id: 'l', status: 'uploading', expected_chunks: MINUTES, processed_blocks: 0, total_blocks: null, block_failures: 0,
    recorded_at: '2026-11-24T10:30:00Z', created_at: '2026-11-24T10:30:00Z', duration_s: MINUTES * 60,
  } as LessonRow & { error_message?: string | null };
  const segments = new Map<number, Segment[]>();
  const stats = { transcribeCalls: 0, rewriteCalls: 0, maxBlockBytes: 0, rewriteChars: 0, busyLeft: new Set(opts.busyBlocks ?? []), failLeft: new Set(opts.failOnce ?? []) };
  let leased = false;

  const deps: StepDeps = {
    getLesson: () => Promise.resolve({ ...lesson }),
    updateLesson: (p) => { Object.assign(lesson, p); return Promise.resolve(); },
    listChunks: () => Promise.resolve(chunks),
    download: () => Promise.resolve(new Uint8Array(opts.partBytes)),
    replaceSegments: (b, segs) => { segments.set(b, segs); return Promise.resolve(); },
    listSegments: () => Promise.resolve([...segments.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, s]) => s)),
    saveOutputs: () => Promise.resolve(),
    transcribe: (parts: AudioPart[]) => {
      const b = lesson.processed_blocks;
      stats.transcribeCalls++;
      // base64 aumenta 4/3; o limite de envio direto do Gemini é 20 MB.
      stats.maxBlockBytes = Math.max(stats.maxBlockBytes, parts.reduce((t, p) => t + p.data.length, 0) * 4 / 3);
      if (stats.busyLeft.delete(b)) { clock += 2_000; return Promise.reject(new RateLimitError('ocupado', 503, null, 'high demand')); }
      clock += opts.transcribeMs;
      if (stats.failLeft.delete(b)) return Promise.reject(new Error('JSON inválido'));
      return Promise.resolve(parts.flatMap((_, part) =>
        Array.from({ length: SEGMENTS_PER_MINUTE }, (_, k) => ({ part, start: k * (60 / SEGMENTS_PER_MINUTE), end: (k + 1) * (60 / SEGMENTS_PER_MINUTE), text: `frase ${b}-${part}-${k} com umas doze palavras faladas pelo professor durante a aula de hoje` }))));
    },
    rewrite: (t) => { stats.rewriteCalls++; stats.rewriteChars = t.length; clock += opts.rewriteMs; return Promise.resolve({ rewrite: '# R', summary: '- S' }); },
    model: 'm',
    acquireLease: () => { if (leased) return Promise.resolve(false); leased = true; return Promise.resolve(true); },
    releaseLease: () => { leased = false; return Promise.resolve(); },
    now: () => new Date(clock),
  };

  /** A tela aberta chama a cada 15 s depois que a chamada anterior termina; até a aula ficar pronta. */
  async function run(maxCalls = 200) {
    const calls: number[] = [];
    const startedAt = clock;
    while (lesson.status !== 'ready' && lesson.status !== 'error' && calls.length < maxCalls) {
      const t0 = clock;
      await processUntilDone('l', deps);
      calls.push(clock - t0);
      clock += 15_000;
    }
    return { calls, totalMs: clock - startedAt };
  }
  return { run, lesson, segments, stats };
}

Deno.test('aula de 1h30 gravada: 9 blocos + reescrita, nenhuma chamada passa do limite da função', async () => {
  const sim = simulate({ transcribeMs: 40_000, rewriteMs: 60_000, partBytes: 360_000 });
  const { calls, totalMs } = await sim.run();
  assertEquals(sim.lesson.status, 'ready');
  assertEquals(sim.stats.transcribeCalls, MINUTES / BLOCK_SIZE);
  assertEquals(sim.stats.rewriteCalls, 1);
  assert(Math.max(...calls) < FUNCTION_LIMIT_MS, `uma chamada levou ${Math.max(...calls) / 1000} s`);
  // A reescrita recebe a aula inteira, até o último minuto.
  assert(sim.stats.rewriteChars > 0);
  const all = [...sim.segments.values()].flat();
  assertEquals(all.length, MINUTES * SEGMENTS_PER_MINUTE);
  assert(all.length > 1000, 'a simulação precisa passar de 1000 trechos');
  console.log(`1h30 gravada: ${calls.length} chamadas da função, pronta em ${Math.round(totalMs / 60_000)} min, maior chamada ${Math.round(Math.max(...calls) / 1000)} s, ${sim.stats.transcribeCalls + sim.stats.rewriteCalls} pedidos ao Gemini, bloco de ${(sim.stats.maxBlockBytes / 1e6).toFixed(1)} MB`);
});

Deno.test('aula de 1h30 importada (partes de 1,4 MB): bloco cabe no limite de 20 MB do Gemini', async () => {
  const sim = simulate({ transcribeMs: 60_000, rewriteMs: 80_000, partBytes: 1_400_000 });
  const { calls } = await sim.run();
  assertEquals(sim.lesson.status, 'ready');
  assert(sim.stats.maxBlockBytes < 20_000_000, `bloco de ${sim.stats.maxBlockBytes} bytes em base64`);
  assert(Math.max(...calls) < FUNCTION_LIMIT_MS, `uma chamada levou ${Math.max(...calls) / 1000} s`);
});

Deno.test('Gemini ocupado e uma resposta ruim no meio: não trava, não pula trecho, poucas chamadas a mais', async () => {
  const sim = simulate({ transcribeMs: 40_000, rewriteMs: 60_000, partBytes: 360_000, busyBlocks: [2, 6], failOnce: [4] });
  const { calls } = await sim.run();
  assertEquals(sim.lesson.status, 'ready');
  assertEquals(sim.segments.size, MINUTES / BLOCK_SIZE);
  assert([...sim.segments.values()].every((s) => s.length > 0), 'algum bloco ficou vazio');
  // 9 blocos + 2 recusas + 1 falha repetida + reescrita
  assertEquals(sim.stats.transcribeCalls + sim.stats.rewriteCalls, 9 + 2 + 1 + 1);
  assert(Math.max(...calls) < FUNCTION_LIMIT_MS);
  assert(!sim.lesson.error_message, `ficou aviso: ${sim.lesson.error_message}`);
});

Deno.test('pior caso: cada bloco no limite de 90 s, ainda dentro dos 150 s da função', async () => {
  const sim = simulate({ transcribeMs: 90_000, rewriteMs: 90_000, partBytes: 360_000 });
  const { calls } = await sim.run();
  assertEquals(sim.lesson.status, 'ready');
  assert(Math.max(...calls) <= 45_000 + 90_000 + 1, `uma chamada levou ${Math.max(...calls) / 1000} s`);
});
