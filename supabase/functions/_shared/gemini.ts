import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import type { AudioPart, ModelSegment } from './types.ts';
import { REWRITE_PROMPT, TRANSCRIBE_PROMPT } from './prompts.ts';

// Flash-Lite tem nível grátis com cota diária folgada e aceita áudio. Dá para trocar pelo segredo GEMINI_MODEL, sem reimplantar.
export const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL')?.trim() || 'gemini-3.5-flash-lite';

export class RateLimitError extends Error {}
export const GEMINI_TIMEOUT_MS = 90_000;
export class GeminiError extends Error {}
/** Cota esgotada ou sem nível grátis: esperar não resolve. */
export class QuotaError extends GeminiError {}

type Opts = { apiKey?: string; fetcher?: typeof fetch; model?: string; maxOutputTokens?: number };

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

async function generate(parts: unknown[], schema: unknown, opts: Opts): Promise<unknown> {
  const apiKey = (opts.apiKey ?? Deno.env.get('GEMINI_API_KEY'))?.trim();
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY não configurada');
  const fetcher = opts.fetcher ?? fetch;
  const model = opts.model ?? GEMINI_MODEL;
  // A função só pode rodar 150 s; uma resposta lenta não pode segurá-la até ser derrubada.
  const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
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
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new RateLimitError('Gemini demorou demais para responder');
    throw e;
  });
  if (res.status === 429 || res.status === 503) {
    const body = await res.text().catch(() => '');
    if (/exceeded your current quota|limit: 0/i.test(body)) {
      throw new QuotaError(
        `Sem cota do Gemini para o modelo ${model}: troque o modelo ou espere a cota diária renovar e toque em Tentar de novo.`,
      );
    }
    throw new RateLimitError(`Gemini ocupado (${res.status}): ${body.slice(0, 200)}`);
  }
  if (!res.ok) throw new GeminiError(`Gemini respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

export async function transcribeBlock(parts: AudioPart[], opts: Opts = {}): Promise<ModelSegment[]> {
  const content: unknown[] = [{ text: TRANSCRIBE_PROMPT }];
  parts.forEach((p, i) => {
    content.push({ text: `Parte ${i}` });
    content.push({ inline_data: { mime_type: p.mimeType.split(';')[0].trim(), data: encodeBase64(p.data) } });
  });
  const result = await generate(content, SEGMENTS_SCHEMA, opts);
  return Array.isArray(result) ? (result as ModelSegment[]) : [];
}

export async function rewriteAndSummarize(transcript: string, opts: Opts = {}): Promise<{ rewrite: string; summary: string }> {
  const result = (await generate([{ text: REWRITE_PROMPT + transcript }], OUTPUTS_SCHEMA, opts)) as
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

/** Uma única chamada: junta o texto de várias aulas num material só. */
export async function combineTexts(prompt: string, opts: Opts = {}): Promise<{ title: string; content: string }> {
  // Saída limitada: segura o tempo de resposta e o gasto da cota.
  const result = (await generate([{ text: prompt }], COMBINED_SCHEMA, { maxOutputTokens: 8192, ...opts })) as { title?: string; content?: string } | null;
  if (!result?.content) throw new GeminiError('Resposta sem o texto combinado');
  return { title: result.title?.trim() ?? '', content: result.content };
}
