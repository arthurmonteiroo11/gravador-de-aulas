import { supabase } from '../lib/supabase';
import { listPending } from '../storage/localQueue';
import { finishRecording } from './api';

/** Une as partes que estão no aparelho e na nuvem (sem repetir) para fechar uma aula interrompida. */
export function summarizeChunks(
  local: Array<{ idx: number; durationS: number }>,
  remote: Array<{ idx: number; duration_s: number }>,
): { chunkCount: number; durationS: number } {
  const byIdx = new Map<number, number>();
  for (const r of remote) byIdx.set(r.idx, r.duration_s);
  for (const l of local) byIdx.set(l.idx, l.durationS);
  let durationS = 0;
  for (const d of byIdx.values()) durationS += d;
  return { chunkCount: byIdx.size, durationS: Math.round(durationS) };
}

/** Fecha uma aula que ficou "gravando" porque o app foi fechado no meio. */
export async function finalizeAbandoned(lessonId: string): Promise<void> {
  const local = await listPending(lessonId);
  const { data, error } = await supabase.from('audio_chunks').select('idx, duration_s').eq('lesson_id', lessonId);
  if (error) throw error;
  const { chunkCount, durationS } = summarizeChunks(local, data ?? []);
  await finishRecording(lessonId, durationS, chunkCount);
}
