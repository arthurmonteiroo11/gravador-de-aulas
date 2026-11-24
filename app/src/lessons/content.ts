import { supabase } from '../lib/supabase';
import type { AudioChunk, Segment } from '../lib/types';

export type LessonContent = {
  segments: Segment[];
  rewrite: string | null;
  summary: string | null;
  chunks: AudioChunk[];
};

/** O banco entrega no máximo 1000 linhas por pedido; uma aula de 1h30 pode passar disso. */
export const PAGE = 1000;
export async function allPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

export async function loadLessonContent(lessonId: string): Promise<LessonContent> {
  const [segs, outs, chunks] = await Promise.all([
    allPages<Segment>((from, to) =>
      supabase.from('transcript_segments').select('id, start_s, end_s, text, speaker').eq('lesson_id', lessonId).order('start_s').order('id').range(from, to),
    ).catch(() => [] as Segment[]),
    supabase.from('lesson_outputs').select('kind, content_md').eq('lesson_id', lessonId),
    supabase.from('audio_chunks').select('lesson_id, idx, start_s, duration_s, path, mime_type').eq('lesson_id', lessonId).order('idx'),
  ]);
  const out = (kind: string) => (outs.data ?? []).find((o) => o.kind === kind)?.content_md ?? null;
  return { segments: segs, rewrite: out('rewrite'), summary: out('summary'), chunks: (chunks.data ?? []) as AudioChunk[] };
}

/** Links temporários (1 h) para tocar o áudio de cada parte. */
export async function signedUrls(chunks: AudioChunk[]): Promise<Map<number, string>> {
  if (!chunks.length) return new Map();
  const { data } = await supabase.storage.from('audio').createSignedUrls(chunks.map((c) => c.path), 3600);
  const map = new Map<number, string>();
  (data ?? []).forEach((d, i) => d.signedUrl && map.set(chunks[i].idx, d.signedUrl));
  return map;
}
