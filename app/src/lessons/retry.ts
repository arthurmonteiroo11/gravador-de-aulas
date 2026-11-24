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

const BLOCK_SIZE = 10;
export const isWaitingForGemini = (l: Pick<Lesson, 'status' | 'error_message'>) =>
  l.status === 'processing' && Boolean(l.error_message?.startsWith('Aguardando o Gemini'));

/** Recomeça a transcrição do zero com o áudio que está no servidor (para pegar quem fala, por exemplo). */
export function retranscribePatch(chunkCount: number) {
  return { status: 'processing' as const, total_blocks: Math.ceil(chunkCount / BLOCK_SIZE), processed_blocks: 0, block_failures: 0, error_message: null };
}

export async function retranscribe(lessonId: string, chunkCount: number): Promise<ReturnType<typeof retranscribePatch>> {
  if (chunkCount < 1) throw new Error('O áudio desta aula já saiu do servidor.');
  const patch = retranscribePatch(chunkCount);
  const { error } = await supabase.from('lessons').update(patch).eq('id', lessonId);
  if (error) throw new Error('Não deu para recomeçar. Verifique a internet.');
  return patch;
}
