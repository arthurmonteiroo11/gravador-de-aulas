import { supabase } from '../lib/supabase';
import type { Lesson, LessonStatus } from '../lib/types';

export async function createLesson(input: { title: string; subject?: string; recordedAt?: Date }): Promise<Lesson> {
  const { data, error } = await supabase
    .from('lessons')
    .insert({ title: input.title, subject: input.subject || null, ...(input.recordedAt ? { recorded_at: input.recordedAt.toISOString() } : {}) })
    .select()
    .single();
  if (error) throw error;
  return data as Lesson;
}

export async function listLessons(): Promise<Lesson[]> {
  const { data, error } = await supabase.from('lessons').select('*').order('recorded_at', { ascending: false });
  if (error) throw error;
  return data as Lesson[];
}

export async function getLesson(id: string): Promise<Lesson> {
  const { data, error } = await supabase.from('lessons').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Lesson;
}

/** Marca o fim da gravação. O servidor só processa quando as `chunkCount` partes chegarem. */
export async function finishRecording(lessonId: string, durationS: number, chunkCount: number): Promise<void> {
  const { error } = await supabase
    .from('lessons')
    .update({ status: 'uploading', duration_s: durationS, expected_chunks: chunkCount })
    .eq('id', lessonId);
  if (error) throw error;
}

export async function requestProcessing(lessonId: string): Promise<{ status: LessonStatus }> {
  const { data, error } = await supabase.functions.invoke('process-lesson', { body: { lessonId } });
  if (error) throw error;
  return data as { status: LessonStatus };
}

export async function updateLesson(id: string, patch: { title?: string; subject?: string | null }): Promise<void> {
  const { data, error } = await supabase.from('lessons').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Nada foi salvo.');
}

/** Apaga a aula de vez: primeiro os arquivos de áudio, depois a aula (o resto vai junto no banco). */
export async function deleteLesson(lesson: Pick<Lesson, 'id' | 'user_id'>): Promise<void> {
  const folder = `${lesson.user_id}/${lesson.id}`;
  const { data: files, error: listError } = await supabase.storage.from('audio').list(folder, { limit: 1000 });
  if (listError) throw listError;
  if (files?.length) {
    const { error } = await supabase.storage.from('audio').remove(files.map((f) => `${folder}/${f.name}`));
    if (error) throw error;
  }
  const { error } = await supabase.from('lessons').delete().eq('id', lesson.id);
  if (error) throw error;
}

/** Apaga várias aulas, uma de cada vez; as que falharem voltam na lista para tentar de novo. */
export async function deleteLessons(
  lessons: Pick<Lesson, 'id' | 'user_id' | 'title'>[],
  onProgress: (done: number) => void = () => {},
): Promise<string[]> {
  const { pendingKeys, removeChunk } = await import('../storage/localQueue');
  const failed: string[] = [];
  for (let i = 0; i < lessons.length; i++) {
    onProgress(i);
    try {
      await deleteLesson(lessons[i]);
      for (const c of await pendingKeys(lessons[i].id).catch(() => [])) await removeChunk(lessons[i].id, c.idx).catch(() => {});
    } catch {
      failed.push(lessons[i].id);
    }
  }
  onProgress(lessons.length);
  return failed;
}
