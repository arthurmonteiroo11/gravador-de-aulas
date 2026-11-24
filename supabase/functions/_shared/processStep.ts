import { BLOCK_SIZE, groupIntoBlocks, toAbsoluteSegments, transcriptText } from './blocks.ts';
import { RateLimitError } from './gemini.ts';
import type { AudioChunk, AudioPart, LessonRow, LessonStatus, ModelSegment, Segment } from './types.ts';

export const MAX_BLOCK_FAILURES = 3;
const SILENT = 'Nenhuma fala detectada nesta gravação.';

export type StepDeps = {
  getLesson: (id: string) => Promise<LessonRow>;
  updateLesson: (patch: Partial<LessonRow> & { error_message?: string | null }) => Promise<void>;
  listChunks: () => Promise<AudioChunk[]>;
  download: (path: string) => Promise<Uint8Array>;
  replaceSegments: (blockIdx: number, segs: Segment[]) => Promise<void>;
  listSegments: () => Promise<Segment[]>;
  saveOutputs: (o: { rewrite: string; summary: string }) => Promise<void>;
  transcribe: (parts: AudioPart[]) => Promise<ModelSegment[]>;
  rewrite: (transcript: string) => Promise<{ rewrite: string; summary: string }>;
  model: string;
};

export type StepResult = { status: LessonStatus; processed_blocks: number; total_blocks: number | null };

const result = (l: LessonRow): StepResult => ({ status: l.status, processed_blocks: l.processed_blocks, total_blocks: l.total_blocks });

/** Avança a aula um passo: libera para processar, transcreve um bloco ou gera reescrita e resumo. */
export async function processStep(lessonId: string, deps: StepDeps): Promise<StepResult> {
  const lesson = await deps.getLesson(lessonId);

  if (lesson.status === 'uploading') {
    const chunks = await deps.listChunks();
    if (lesson.expected_chunks === null || chunks.length < lesson.expected_chunks) return result(lesson);
    if (chunks.length === 0) {
      const patch = { status: 'error' as const, error_message: 'Nenhum áudio foi gravado.' };
      await deps.updateLesson(patch);
      return result({ ...lesson, ...patch });
    }
    const patch = { status: 'processing' as const, total_blocks: Math.ceil(chunks.length / BLOCK_SIZE), processed_blocks: 0, block_failures: 0 };
    await deps.updateLesson(patch);
    return result({ ...lesson, ...patch });
  }

  if (lesson.status !== 'processing' || lesson.total_blocks === null) return result(lesson);

  if (lesson.processed_blocks < lesson.total_blocks) {
    const b = lesson.processed_blocks;
    try {
      const block = groupIntoBlocks(await deps.listChunks())[b] ?? [];
      const parts = await Promise.all(block.map(async (c) => ({ data: await deps.download(c.path), mimeType: c.mime_type })));
      const segs = parts.length ? await deps.transcribe(parts) : [];
      await deps.replaceSegments(b, toAbsoluteSegments(block, segs));
      const patch = { processed_blocks: b + 1, block_failures: 0 };
      await deps.updateLesson(patch);
      return result({ ...lesson, ...patch });
    } catch (e) {
      return recordFailure(lesson, deps, e, `Falha ao transcrever o bloco ${b + 1}`);
    }
  }

  try {
    const segments = await deps.listSegments();
    const outputs = segments.length ? await deps.rewrite(transcriptText(segments)) : { rewrite: SILENT, summary: SILENT };
    await deps.saveOutputs(outputs);
    const patch = { status: 'ready' as const, error_message: null };
    await deps.updateLesson(patch);
    return result({ ...lesson, ...patch });
  } catch (e) {
    return recordFailure(lesson, deps, e, 'Falha ao gerar reescrita');
  }
}

/** Limite do Gemini não conta como falha; outros erros contam e, na 3ª, a aula vira erro. */
async function recordFailure(lesson: LessonRow, deps: StepDeps, e: unknown, what: string): Promise<StepResult> {
  if (e instanceof RateLimitError) return result(lesson);
  const failures = lesson.block_failures + 1;
  const patch = failures >= MAX_BLOCK_FAILURES
    ? { block_failures: failures, status: 'error' as const, error_message: `${what}: ${String(e)}` }
    : { block_failures: failures };
  await deps.updateLesson(patch);
  return result({ ...lesson, ...patch });
}
