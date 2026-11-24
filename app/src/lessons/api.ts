import { supabase } from '../lib/supabase';
import type { Lesson, LessonStatus } from '../lib/types';

export async function createLesson(input: { title: string; subject?: string }): Promise<Lesson> {
  const { data, error } = await supabase
    .from('lessons')
    .insert({ title: input.title, subject: input.subject || null })
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
