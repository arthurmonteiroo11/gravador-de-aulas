import { supabase } from '../lib/supabase';

export type StudyNote = { id: string; title: string; lesson_ids: string[]; content_md: string; created_at: string };

const must = <T>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};

/** Uma atualização que não achou a linha (permissão faltando no banco) também é erro: nada foi salvo. */
const changed = (r: { data: unknown[] | null; error: unknown }): void => {
  if (r.error) throw r.error;
  if (!r.data?.length) throw new Error('Nada foi salvo.');
};

export async function saveNotes(lessonId: string, notes: string): Promise<void> {
  changed(await supabase.from('lessons').update({ notes }).eq('id', lessonId).select('id'));
}

export async function saveOutput(lessonId: string, kind: 'summary' | 'rewrite', contentMd: string): Promise<void> {
  changed(await supabase.from('lesson_outputs').update({ content_md: contentMd }).eq('lesson_id', lessonId).eq('kind', kind).select('lesson_id'));
}

export async function saveSegment(id: number, text: string): Promise<void> {
  changed(await supabase.from('transcript_segments').update({ text }).eq('id', id).select('id'));
}

export async function listStudyNotes(): Promise<StudyNote[]> {
  return (must(await supabase.from('study_notes').select('*').order('created_at', { ascending: false })) ?? []) as StudyNote[];
}

export async function getStudyNote(id: string): Promise<StudyNote> {
  return must(await supabase.from('study_notes').select('*').eq('id', id).single()) as StudyNote;
}

export async function saveStudyNote(id: string, patch: Partial<Pick<StudyNote, 'title' | 'content_md'>>): Promise<void> {
  changed(await supabase.from('study_notes').update(patch).eq('id', id).select('id'));
}

export async function deleteStudyNote(id: string): Promise<void> {
  changed(await supabase.from('study_notes').delete().eq('id', id).select('id'));
}

/**
 * Pede ao servidor um resumo único das aulas escolhidas e devolve o id dele.
 * A mesma chave em todas as tentativas: se a conexão cair, repetir não gasta cota de novo.
 */
export async function combineLessons(lessonIds: string[], requestKey: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('process-lesson', { body: { combine: lessonIds, requestKey } });
  if (error) throw new Error(await combineError(error));
  return (data as { id: string }).id;
}

const OFFLINE = 'Não deu para juntar as aulas. Verifique a internet e tente de novo.';

/** O servidor responde {"error": "..."}; mostra só essa frase. */
export async function combineError(error: unknown, offline = OFFLINE): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (typeof ctx?.json !== 'function') return offline;
  const body = (await ctx.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error ? body.error : offline;
}
