import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import type { AudioPart, ModelSegment } from './types.ts';
import { REWRITE_PROMPT, TRANSCRIBE_PROMPT } from './prompts.ts';
import { cleanCards, type Card } from './flashcards.ts';

// Flash-Lite tem nível grátis com cota diária folgada e aceita áudio. Dá para trocar pelo segredo GEMINI_MODEL, sem reimplantar.
export const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-3.5-flash-lite';

/**
 * Modelos reserva, com nível grátis e cota própria: usados quando o principal está sobrecarregado (503),
 * no limite por minuto (429) ou sem cota no dia. Dá para trocar pelo segredo GEMINI_FALLBACK_MODELS,
 * separados por vírgula. Um nome que não existir mais é pulado.
 */
export const GEMINI_FALLBACK_MODELS = (Deno.env.get('GEMINI_FALLBACK_MODELS') ?? 'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m && m !== GEMINI_MODEL);

/** Recusa passageira (429 por minuto, 503 sobrecarregado) ou resposta lenta: vale tentar de novo depois. */
export class RateLimitError extends Error {
  constructor(message: string, readonly status = 0, readonly retryAfterS: number | null = null, readonly reason = '') {
    super(message);
  }
}
/** O Gemini não respondeu dentro do prazo. */
export class GeminiTimeoutError extends RateLimitError {}
export const GEMINI_TIMEOUT_MS = 90_000;
export class GeminiError extends Error {}
/** Cota esgotada ou sem nível grátis: esperar não resolve. */
export class QuotaError extends GeminiError {}
/** O modelo não existe (mais) para esta chave. */
class ModelNotFoundError extends GeminiError {}

type Opts = { /** Matéria e termos da pasta, quando houver. */ context?: string; apiKey?: string; fetcher?: typeof fetch; model?: string; fallbacks?: string[]; maxOutputTokens?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> };

/** A frase que o Google manda no corpo do erro, sem o resto do JSON. */
function googleMessage(body: string): string {
  try {
    const m = JSON.parse(body)?.error?.message;
    if (typeof m === 'string' && m) return m.slice(0, 160);
  } catch { /* corpo não é JSON */ }
  return body.slice(0, 160);
}

/** "retryDelay": "23s" no corpo, ou o cabeçalho Retry-After. */
function retryAfter(res: Response, body: string): number | null {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Number(m[1]);
  const h = Number(res.headers.get('retry-after'));
  return Number.isFinite(h) && h > 0 ? h : null;
}

const SEGMENTS_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { part: { type: 'INTEGER' }, start: { type: 'NUMBER' }, end: { type: 'NUMBER' }, text: { type: 'STRING' } },
    required: ['part', 'start', 'end', 'text'],
  },
};

const OUTPUTS_SCHEMA = {
  type: 'OBJECT',
  properties: { rewrite: { type: 'STRING' }, summary: { type: 'STRING' } },
  required: ['rewrite', 'summary'],
};

/**
 * Pede ao modelo principal; se ele recusar por sobrecarga ou cota, passa para os reserva, em ordem.
 * Demora (timeout) não troca de modelo: outra chamada lenta estouraria o tempo da função.
 */
async function generate(parts: unknown[], schema: unknown, opts: Opts): Promise<unknown> {
  const models = [opts.model ?? GEMINI_MODEL, ...(opts.fallbacks ?? GEMINI_FALLBACK_MODELS)];
  let firstError: unknown = null;
  for (const [i, model] of models.entries()) {
    try {
      return await generateWith(model, parts, schema, opts);
    } catch (e) {
      const switchable = (e instanceof RateLimitError && !(e instanceof GeminiTimeoutError)) || e instanceof QuotaError || (i > 0 && e instanceof ModelNotFoundError);
      if (!switchable) throw e;
      if (!(e instanceof ModelNotFoundError)) firstError ??= e;
      console.warn(`Gemini ${model} recusou (${(e as Error).message.slice(0, 120)}); tentando o próximo modelo`);
    }
  }
  throw firstError ?? new GeminiError('Nenhum modelo do Gemini disponível');
}

async function generateWith(model: string, parts: unknown[], schema: unknown, opts: Opts): Promise<unknown> {
  const apiKey = (opts.apiKey ?? Deno.env.get('GEMINI_API_KEY'))?.trim();
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY não configurada');
  const fetcher = opts.fetcher ?? fetch;
  // A função só pode rodar 150 s; uma resposta lenta não pode segurá-la até ser derrubada.
  const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? GEMINI_TIMEOUT_MS),
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      },
    }),
  }).catch((e) => {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new GeminiTimeoutError('Gemini demorou demais para responder');
    throw e;
  });
  if (res.status === 429 || res.status === 503) {
    const body = await res.text().catch(() => '');
    if (/exceeded your current quota|limit: 0/i.test(body)) {
      throw new QuotaError(
        `Sem cota do Gemini para o modelo ${model}: troque o modelo ou espere a cota diária renovar e toque em Tentar de novo.`,
      );
    }
    throw new RateLimitError(`Gemini ocupado (${res.status}): ${googleMessage(body)}`, res.status, retryAfter(res, body), googleMessage(body));
  }
  if (res.status === 404) throw new ModelNotFoundError(`Modelo ${model} não encontrado`);
  if (!res.ok) throw new GeminiError(`Gemini respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

/** Tipo como o Gemini espera: sem parâmetros, e mp3 com o nome que ele usa. */
export function geminiMime(mime: string): string {
  const pure = mime.split(';')[0].trim().toLowerCase();
  return pure === 'audio/mpeg' ? 'audio/mp3' : pure;
}

/** O contexto da matéria vai antes das instruções, para valer no pedido inteiro. */
const withContext = (prompt: string, context?: string) => (context ? `${context}\n\n${prompt}` : prompt);

export async function transcribeBlock(parts: AudioPart[], opts: Opts = {}): Promise<ModelSegment[]> {
  const content: unknown[] = [{ text: withContext(TRANSCRIBE_PROMPT, opts.context) }];
  parts.forEach((p, i) => {
    content.push({ text: `Parte ${i}` });
    content.push({ inline_data: { mime_type: geminiMime(p.mimeType), data: encodeBase64(p.data) } });
  });
  const result = await generate(content, SEGMENTS_SCHEMA, opts);
  return Array.isArray(result) ? (result as ModelSegment[]) : [];
}

export async function rewriteAndSummarize(transcript: string, opts: Opts = {}): Promise<{ rewrite: string; summary: string }> {
  const result = (await generate([{ text: withContext(REWRITE_PROMPT, opts.context) + transcript }], OUTPUTS_SCHEMA, opts)) as
    | { rewrite?: string; summary?: string }
    | null;
  if (!result?.rewrite || !result?.summary) throw new GeminiError('Resposta sem reescrita ou resumo');
  return { rewrite: result.rewrite, summary: result.summary };
}

const COMBINED_SCHEMA = {
  type: 'OBJECT',
  properties: { title: { type: 'STRING' }, content: { type: 'STRING' } },
  required: ['title', 'content'],
};

/** Prazo total do resumo combinado: a função é derrubada em 150 s. */
export const COMBINE_BUDGET_MS = 125_000;

/**
 * Junta o texto de várias aulas num material só. Uma chamada; se o Gemini recusar na hora
 * (limite por minuto, sobrecarga), espera e tenta de novo enquanto couber no prazo.
 */
export async function combineTexts(prompt: string, opts: Opts = {}): Promise<{ title: string; content: string }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = Date.now();
  for (let attempt = 1; ; attempt++) {
    const left = COMBINE_BUDGET_MS - (Date.now() - start);
    try {
      return await combineOnce(prompt, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 110_000, left) });
    } catch (e) {
      if (!(e instanceof RateLimitError) || e instanceof GeminiTimeoutError || attempt >= 3) throw e;
      const waitMs = Math.min((e.retryAfterS ?? 4 * attempt) * 1000, 30_000);
      // Só espera se ainda sobrar tempo de verdade para a resposta.
      if (COMBINE_BUDGET_MS - (Date.now() - start) - waitMs < 45_000) throw e;
      await sleep(waitMs);
    }
  }
}

async function combineOnce(prompt: string, opts: Opts): Promise<{ title: string; content: string }> {
  // Saída limitada: segura o tempo de resposta e o gasto da cota.
  const result = (await generate([{ text: prompt }], COMBINED_SCHEMA, { maxOutputTokens: 8192, ...opts })) as { title?: string; content?: string } | null;
  if (!result?.content) throw new GeminiError('Resposta sem o texto combinado');
  return { title: result.title?.trim() ?? '', content: result.content };
}

const CARDS_SCHEMA = {
  type: 'ARRAY',
  items: { type: 'OBJECT', properties: { front: { type: 'STRING' }, back: { type: 'STRING' } }, required: ['front', 'back'] },
};

/** Uma chamada: flashcards a partir do texto de uma aula. */
export async function makeFlashcards(prompt: string, opts: Opts = {}): Promise<Card[]> {
  const cards = cleanCards(await generate([{ text: prompt }], CARDS_SCHEMA, { maxOutputTokens: 4096, timeoutMs: 90_000, ...opts }));
  if (!cards.length) throw new GeminiError('O Gemini não devolveu cartões');
  return cards;
}

const ASK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    sources: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { n: { type: 'INTEGER' }, lesson: { type: 'STRING' }, time: { type: 'STRING' }, quote: { type: 'STRING' } },
        required: ['n', 'lesson', 'time', 'quote'],
      },
    },
  },
  required: ['answer', 'sources'],
};

/** Uma pergunta sobre as aulas: uma chamada, resposta curta com as fontes. */
export async function askAboutLessons(prompt: string, opts: Opts = {}): Promise<unknown> {
  return await generate([{ text: prompt }], ASK_SCHEMA, { maxOutputTokens: 2048, timeoutMs: 75_000, ...opts });
}
