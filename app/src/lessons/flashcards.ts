import { supabase } from '../lib/supabase';
import { combineError } from './study';

export type Flashcard = {
  id: string;
  lesson_id: string;
  front: string;
  back: string;
  box: number;
  due_at: string;
  reviewed_at: string | null;
};

/** Dias até a próxima revisão em cada caixa (Leitner): quanto mais acerta, mais espaçado. */
export const BOX_DAYS = [1, 3, 7, 14, 30] as const;
const DAY = 86_400_000;

/** Para onde o cartão vai depois de uma resposta. Errou: volta para a caixa 1 e aparece amanhã. */
export function nextReview(box: number, correct: boolean, now = new Date()): { box: number; due_at: string } {
  const next = correct ? Math.min(5, Math.max(1, box) + 1) : 1;
  const days = correct ? BOX_DAYS[next - 1] : BOX_DAYS[0];
  return { box: next, due_at: new Date(now.getTime() + days * DAY).toISOString() };
}

const must = <T>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};

export async function cardsOfLesson(lessonId: string): Promise<Flashcard[]> {
  return (must(await supabase.from('flashcards').select('*').eq('lesson_id', lessonId).order('created_at')) ?? []) as Flashcard[];
}

/** Modo prova: todos os cartões das aulas da pasta, vencidos ou não. */
export async function cardsOfLessons(lessonIds: string[]): Promise<Flashcard[]> {
  if (!lessonIds.length) return [];
  return (must(await supabase.from('flashcards').select('*').in('lesson_id', lessonIds).order('due_at').limit(400)) ?? []) as Flashcard[];
}

/** Quais destas aulas já têm cartões. */
export async function lessonsWithCards(lessonIds: string[]): Promise<Set<string>> {
  if (!lessonIds.length) return new Set();
  const rows = must(await supabase.from('flashcards').select('lesson_id').in('lesson_id', lessonIds).limit(5000)) ?? [];
  return new Set((rows as { lesson_id: string }[]).map((r) => r.lesson_id));
}

/** Cartões que já venceram, de todas as aulas, os mais atrasados primeiro. */
export async function dueCards(now = new Date(), limit = 60): Promise<Flashcard[]> {
  return (must(await supabase.from('flashcards').select('*').lte('due_at', now.toISOString()).order('due_at').limit(limit)) ?? []) as Flashcard[];
}

export async function dueCount(now = new Date()): Promise<number> {
  const { count, error } = await supabase.from('flashcards').select('id', { count: 'exact', head: true }).lte('due_at', now.toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function cardCount(lessonId: string): Promise<number> {
  const { count, error } = await supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('lesson_id', lessonId);
  if (error) throw error;
  return count ?? 0;
}

export async function gradeCard(card: Flashcard, correct: boolean, now = new Date()): Promise<Flashcard> {
  const patch = { ...nextReview(card.box, correct, now), reviewed_at: now.toISOString() };
  const rows = must(await supabase.from('flashcards').update(patch).eq('id', card.id).select('id'));
  if (!rows?.length) throw new Error('Nada foi salvo.');
  return { ...card, ...patch };
}

/** Pede ao servidor os cartões da aula (uma chamada ao Gemini). Com replace, troca os que já existem. */
export async function createFlashcards(lessonId: string, replace = false): Promise<number> {
  const { data, error } = await supabase.functions.invoke('process-lesson', { body: { flashcards: lessonId, replace } });
  if (error) throw new Error(await combineError(error, 'Não deu para criar os flashcards. Verifique a internet e tente de novo.'));
  return (data as { count: number }).count;
}
