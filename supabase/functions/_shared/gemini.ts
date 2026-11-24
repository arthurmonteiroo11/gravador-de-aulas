import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import type { AudioPart, ModelSegment } from './types.ts';
import { REWRITE_PROMPT, TRANSCRIBE_PROMPT } from './prompts.ts';

export const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';

export class RateLimitError extends Error {}
export class GeminiError extends Error {}

type Opts = { apiKey?: string; fetcher?: typeof fetch; model?: string };

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
  const apiKey = opts.apiKey ?? Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY não configurada');
  const fetcher = opts.fetcher ?? fetch;
  const model = opts.model ?? GEMINI_MODEL;
  const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
    }),
  });
  if (res.status === 429 || res.status === 503) throw new RateLimitError(`Gemini ocupado (${res.status})`);
  if (!res.ok) throw new GeminiError(`Gemini respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

export async function transcribeBlock(parts: AudioPart[], opts: Opts = {}): Promise<ModelSegment[]> {
  const content: unknown[] = [{ text: TRANSCRIBE_PROMPT }];
  parts.forEach((p, i) => {
    content.push({ text: `Parte ${i}` });
    content.push({ inline_data: { mime_type: p.mimeType, data: encodeBase64(p.data) } });
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
