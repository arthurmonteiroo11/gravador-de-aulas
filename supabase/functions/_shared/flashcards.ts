import { FLASHCARDS_PROMPT } from './prompts.ts';

export type Card = { front: string; back: string };

/** Limite do material enviado: um cartão bom sai do resumo e da reescrita, não precisa da aula inteira. */
export const MAX_FLASHCARD_CHARS = 40_000;

export function flashcardsPrompt(title: string, text: string): string {
  return `${FLASHCARDS_PROMPT}# ${title}\n\n${text.slice(0, MAX_FLASHCARD_CHARS)}`;
}

/** Limpa a resposta do modelo: sem vazios, sem repetidos, no máximo 20. */
export function cleanCards(raw: unknown): Card[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of raw) {
    const front = typeof c?.front === 'string' ? c.front.trim() : '';
    const back = typeof c?.back === 'string' ? c.back.trim() : '';
    const key = front.toLowerCase();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    out.push({ front: front.slice(0, 300), back: back.slice(0, 600) });
  }
  return out.slice(0, 20);
}
