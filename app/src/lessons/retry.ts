import { supabase } from '../lib/supabase';
import type { Lesson } from '../lib/types';

type RetryPatch = { status: 'processing' | 'uploading'; block_failures: 0; error_message: null };

/** O que muda na aula ao tocar em "Tentar de novo". */
export function retryPatch(l: Pick<Lesson, 'status' | 'total_blocks'>): RetryPatch | null {
  if (l.status !== 'error') return null;
  return { status: l.total_blocks === null ? 'uploading' : 'processing', block_failures: 0, error_message: null };
}

export async function retryLesson(l: Lesson): Promise<void> {
  const patch = retryPatch(l);
  if (!patch) return;
  const { error } = await supabase.from('lessons').update(patch).eq('id', l.id);
  if (error) throw error;
}
