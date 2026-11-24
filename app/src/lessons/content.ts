import { supabase } from '../lib/supabase';
import type { AudioChunk, Segment } from '../lib/types';

export type LessonContent = {
  segments: Segment[];
  rewrite: string | null;
  summary: string | null;
  chunks: AudioChunk[];
};

export async function loadLessonContent(lessonId: string): Promise<LessonContent> {
  const [segs, outs, chunks] = await Promise.all([
    supabase.from('transcript_segments').select('id, start_s, end_s, text, speaker').eq('lesson_id', lessonId).order('start_s'),
    supabase.from('lesson_outputs').select('kind, content_md').eq('lesson_id', lessonId),
    supabase.from('audio_chunks').select('lesson_id, idx, start_s, duration_s, path, mime_type').eq('lesson_id', lessonId).order('idx'),
  ]);
  const out = (kind: string) => (outs.data ?? []).find((o) => o.kind === kind)?.content_md ?? null;
  return { segments: (segs.data ?? []) as Segment[], rewrite: out('rewrite'), summary: out('summary'), chunks: (chunks.data ?? []) as AudioChunk[] };
}

/** Links temporários (1 h) para tocar o áudio de cada parte. */
export async function signedUrls(chunks: AudioChunk[]): Promise<Map<number, string>> {
  if (!chunks.length) return new Map();
  const { data } = await supabase.storage.from('audio').createSignedUrls(chunks.map((c) => c.path), 3600);
  const map = new Map<number, string>();
  (data ?? []).forEach((d, i) => d.signedUrl && map.set(chunks[i].idx, d.signedUrl));
  return map;
}
