import { supabase } from '../lib/supabase';
import { combineError } from './study';

export type AskSource = { n: number; lessonId: string; title: string; startS: number; quote: string };
export type AskAnswer = { answer: string; sources: AskSource[] };
export type AskTurn = { q: string; a: string };
export type ChatItem = { q: string; answer?: AskAnswer; error?: string };

export const MAX_QUESTION_CHARS = 500;

/** Pergunta às aulas: uma chamada ao Gemini, que responde só com o que o professor disse. */
export async function askLessons(lessonIds: string[], question: string, history: AskTurn[]): Promise<AskAnswer> {
  const { data, error } = await supabase.functions.invoke('process-lesson', {
    body: { ask: lessonIds, question, history: history.slice(-4) },
  });
  if (error) throw new Error(await combineError(error, 'Não deu para perguntar. Verifique a internet e tente de novo.'));
  return data as AskAnswer;
}

/** A conversa fica guardada enquanto o app está aberto: abrir uma fonte e voltar não perde nada. */
const chats = new Map<string, ChatItem[]>();
export const chatKey = (lessonIds: string[]) => [...lessonIds].sort().join(',');
export const savedChat = (key: string) => chats.get(key) ?? [];
export const saveChat = (key: string, items: ChatItem[]) => void chats.set(key, items);

/** Histórico para o servidor: só as trocas que deram certo. */
export const historyOf = (items: ChatItem[]): AskTurn[] =>
  items.filter((i) => i.answer?.answer).map((i) => ({ q: i.q, a: i.answer!.answer }));

/** "[1]" no texto vira uma marca que o app troca por um botão da fonte. */
export function splitCitations(text: string): (string | number)[] {
  const out: (string | number)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(Number(m[1]));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
