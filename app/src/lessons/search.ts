import { supabase } from '../lib/supabase';

/** Minúsculas e sem acento, caractere a caractere (mantém as posições do texto original). */
const fold = (s: string) =>
  Array.from(s, (c) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().charAt(0) || c).join('');

/** Trecho em volta da primeira ocorrência, terminando em palavras inteiras. */
export function snippetAround(text: string, query: string, radius = 60): string {
  const at = fold(text).indexOf(fold(query));
  if (at < 0 || text.length <= query.length + radius * 2) return text;
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + query.length + radius);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) > at ? text.lastIndexOf(' ', end) : end;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Padrão para ilike, com os curingas do banco escapados. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Filterable = { title: string; subject: string | null };

export function filterLessons<T extends Filterable>(lessons: T[], f: { subject: string | null; query: string }): T[] {
  const q = fold(f.query.trim());
  return lessons.filter(
    (l) => (!f.subject || l.subject === f.subject) && (!q || fold(`${l.title} ${l.subject ?? ''}`).includes(q)),
  );
}

export function subjectsOf(lessons: Filterable[]): string[] {
  const set = new Set(lessons.map((l) => l.subject?.trim()).filter((s): s is string => Boolean(s)));
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Pedaços do texto, marcando onde aparece o que foi buscado. */
export function splitMatches(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = fold(query.trim());
  if (!q) return [{ text, hit: false }];
  const folded = fold(text);
  const out: Array<{ text: string; hit: boolean }> = [];
  let from = 0;
  for (let at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, at + q.length)) {
    if (at > from) out.push({ text: text.slice(from, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}

export type TextHit = { lessonId: string; where: 'transcript' | 'summary' | 'rewrite' | 'notes'; snippet: string; startS: number | null };

/** Procura no texto de todas as aulas: transcrição, resumo, reescrita e anotações. */
export async function searchText(query: string): Promise<TextHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [segs, outs, notes] = await Promise.all([
    supabase.from('transcript_segments').select('lesson_id, start_s, text').ilike('text', likePattern(q)).order('start_s').limit(60),
    supabase.from('lesson_outputs').select('lesson_id, kind, content_md').ilike('content_md', likePattern(q)).limit(20),
    supabase.from('lessons').select('id, notes').ilike('notes', likePattern(q)).limit(20),
  ]);
  if (segs.error) throw segs.error;
  if (outs.error) throw outs.error;
  const hits: TextHit[] = (segs.data ?? []).map((s) => ({
    lessonId: s.lesson_id as string, where: 'transcript', snippet: snippetAround(s.text as string, q), startS: s.start_s as number,
  }));
  for (const o of outs.data ?? []) {
    const plain = (o.content_md as string).replace(/[#*_>`-]+/g, ' ').replace(/\s+/g, ' ');
    hits.push({ lessonId: o.lesson_id as string, where: o.kind as 'summary' | 'rewrite', snippet: snippetAround(plain, q), startS: null });
  }
  // Anotações são opcionais: um erro aqui não esconde o resto da busca.
  for (const n of notes.error ? [] : notes.data ?? []) {
    hits.push({ lessonId: n.id as string, where: 'notes', snippet: snippetAround((n.notes as string).replace(/\s+/g, ' '), q), startS: null });
  }
  return hits;
}
