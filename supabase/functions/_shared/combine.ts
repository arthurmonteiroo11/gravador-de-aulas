import { COMBINE_PROMPT } from './prompts.ts';

export type CombineSource = { title: string; subject: string | null; recorded_at: string; text: string };

/** Limite de texto por aula: segura o tamanho do pedido e o gasto da cota. */
export const MAX_CHARS_PER_LESSON = 60_000;
export const MAX_LESSONS = 8;

const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });

/** Monta o pedido ao Gemini com as aulas em ordem de data. */
export function combinePrompt(sources: CombineSource[]): string {
  const ordered = [...sources].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const blocks = ordered.map((s, i) => {
    const head = `### Aula ${i + 1}: ${s.title}${s.subject ? ` (${s.subject})` : ''}, ${day(s.recorded_at)}`;
    return `${head}\n\n${s.text.slice(0, MAX_CHARS_PER_LESSON)}`;
  });
  return COMBINE_PROMPT + blocks.join('\n\n---\n\n');
}

/** Título padrão quando o modelo não devolve um. */
export function fallbackTitle(sources: CombineSource[]): string {
  const subjects = [...new Set(sources.map((s) => s.subject).filter(Boolean))];
  return subjects.length === 1 ? `${subjects[0]}: ${sources.length} aulas` : `Resumo de ${sources.length} aulas`;
}
