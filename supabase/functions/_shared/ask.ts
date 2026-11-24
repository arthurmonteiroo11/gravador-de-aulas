import { ASK_PROMPT } from './prompts.ts';
import { clock, manySpeakers } from './blocks.ts';

export type AskLesson = { id: string; title: string; recorded_at: string; segments: { start_s: number; text: string; speaker?: string | null }[] };
export type AskTurn = { q: string; a: string };
export type AskSource = { n: number; lessonId: string; title: string; startS: number; quote: string };
export type AskAnswer = { answer: string; sources: AskSource[] };

/**
 * Teto do material: uma aula de 1h30 tem uns 90 mil caracteres. 200 mil (~55 mil tokens) cabem duas aulas inteiras
 * e mantêm algumas perguntas seguidas dentro do limite por minuto da cota grátis.
 */
export const MAX_ASK_CHARS = 200_000;
export const MAX_ASK_LESSONS = 8;
export const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY = 4;

const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });

/**
 * As aulas como linhas "[A1 12:34] texto". Com muitas aulas, cada uma ganha a mesma fatia do teto; se a aula
 * não couber, vão trechos espaçados do começo ao fim, para nenhuma parte da aula ficar de fora.
 */
export function askMaterial(lessons: AskLesson[], cap = MAX_ASK_CHARS): string {
  const budget = Math.floor(cap / Math.max(1, lessons.length));
  return lessons.map((l, i) => {
    const label = `A${i + 1}`;
    const who = manySpeakers(l.segments);
    const all = l.segments.map((s) => `[${label} ${clock(s.start_s)}] ${who && s.speaker ? `${s.speaker}: ` : ''}${s.text}`);
    const size = all.reduce((t, line) => t + line.length + 1, 0);
    let lines = all;
    if (size > budget) {
      const keep = budget / size;
      lines = [];
      let used = 0;
      let acc = 0;
      for (const line of all) {
        acc += keep;
        if (acc < 1) continue;
        acc -= 1;
        if (used + line.length + 1 > budget) break;
        lines.push(line);
        used += line.length + 1;
      }
    }
    const note = lines.length < all.length ? ' (trechos espaçados da aula inteira, não ela toda)' : '';
    return `### ${label}: ${l.title}, ${day(l.recorded_at)}${note}\n${lines.join('\n')}`;
  }).join('\n\n');
}

export function askPrompt(lessons: AskLesson[], question: string, history: AskTurn[] = []): string {
  const past = history.slice(-MAX_HISTORY).map((t) => `Aluno: ${t.q.slice(0, 500)}\nMonitor: ${t.a.slice(0, 1500)}`).join('\n\n');
  return [
    ASK_PROMPT,
    '## Aulas\n\n' + askMaterial(lessons),
    past ? `## Conversa até aqui\n\n${past}` : '',
    `## Pergunta do aluno\n\n${question.slice(0, MAX_QUESTION_CHARS)}`,
  ].filter(Boolean).join('\n\n');
}

/** "12:34" ou "1:02:03" em segundos; null se não for um tempo. */
export function parseClock(t: unknown): number | null {
  if (typeof t === 'number' && Number.isFinite(t)) return Math.max(0, t);
  if (typeof t !== 'string') return null;
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Confere as fontes que o modelo deu: a aula tem que existir e o tempo vira o início do trecho
 * mais próximo, para o app abrir exatamente na linha certa da transcrição.
 */
export function cleanAnswer(raw: unknown, lessons: AskLesson[]): AskAnswer {
  const r = (raw ?? {}) as { answer?: unknown; sources?: unknown };
  const answer = typeof r.answer === 'string' ? r.answer.trim() : '';
  const sources: AskSource[] = [];
  const seen = new Set<number>();
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const n = Number(s?.n);
    const idx = Number(String(s?.lesson ?? '').replace(/^A/i, '')) - 1;
    const lesson = lessons[idx];
    const at = parseClock(s?.time);
    if (!Number.isInteger(n) || n < 1 || seen.has(n) || !lesson || at === null || !lesson.segments.length) continue;
    // O trecho que começa mais perto (antes ou no tempo citado).
    let best = lesson.segments[0];
    for (const seg of lesson.segments) {
      if (seg.start_s <= at + 0.5) best = seg;
      else break;
    }
    seen.add(n);
    sources.push({ n, lessonId: lesson.id, title: lesson.title, startS: best.start_s, quote: String(s?.quote ?? '').trim().slice(0, 200) });
  }
  return { answer: answer.slice(0, 6000), sources: sources.sort((a, b) => a.n - b.n).slice(0, 5) };
}
