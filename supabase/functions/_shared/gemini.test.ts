import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { transcribeBlock, rewriteAndSummarize, RateLimitError, QuotaError, GEMINI_MODEL } from './gemini.ts';

const reply = (payload: unknown, status = 200) =>
  new Response(
    JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] } : { error: {} }),
    { status },
  );

Deno.test('transcribeBlock envia as partes em ordem e lê os trechos', async () => {
  let body: any;
  const fetcher = (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(reply([{ part: 0, start: 1, end: 2, text: 'oi' }]));
  };
  const segs = await transcribeBlock(
    [{ data: new Uint8Array([1]), mimeType: 'audio/mp4' }, { data: new Uint8Array([2]), mimeType: 'audio/mp4' }],
    { apiKey: 'k', fetcher },
  );
  assertEquals(segs, [{ part: 0, start: 1, end: 2, text: 'oi' }]);
  const inline = body.contents[0].parts.filter((p: any) => p.inline_data);
  assertEquals(inline.map((p: any) => p.inline_data.data), ['AQ==', 'Ag==']);
  assertEquals(body.generationConfig.responseMimeType, 'application/json');
});

Deno.test('429 vira RateLimitError', async () => {
  const fetcher = () => Promise.resolve(reply(null, 429));
  await assertRejects(() => transcribeBlock([], { apiKey: 'k', fetcher }), RateLimitError);
});

Deno.test('resposta vazia (silêncio) dá lista vazia', async () => {
  const fetcher = () => Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] })));
  assertEquals(await transcribeBlock([], { apiKey: 'k', fetcher }), []);
});

Deno.test('rewriteAndSummarize devolve reescrita e resumo', async () => {
  const fetcher = () => Promise.resolve(reply({ rewrite: '# A', summary: '- b' }));
  assertEquals(await rewriteAndSummarize('[00:00] oi', { apiKey: 'k', fetcher }), { rewrite: '# A', summary: '- b' });
});

Deno.test('Gemini que demora demais vira RateLimitError (tenta de novo depois, sem travar a função)', async () => {
  const fetcher = () => Promise.reject(new DOMException('Signal timed out.', 'TimeoutError'));
  await assertRejects(
    () => transcribeBlock([{ data: new Uint8Array([1]), mimeType: 'audio/mp4' }], { apiKey: 'k', fetcher: fetcher as typeof fetch }),
    RateLimitError,
    'demorou',
  );
});

Deno.test('429 de cota esgotada vira QuotaError, não espera para sempre', async () => {
  const fetcher = () =>
    Promise.resolve(new Response(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.' } }), { status: 429 }));
  await assertRejects(
    () => transcribeBlock([{ data: new Uint8Array([1]), mimeType: 'audio/mp4' }], { apiKey: 'k', fetcher: fetcher as typeof fetch }),
    QuotaError,
    'cota',
  );
});

Deno.test('modelo padrão tem nível grátis', () => {
  assertEquals(GEMINI_MODEL, 'gemini-3.5-flash-lite');
});

Deno.test('combineTexts tenta de novo depois de um 503 e usa o retryDelay', async () => {
  const { combineTexts } = await import('./gemini.ts');
  let calls = 0;
  const waits: number[] = [];
  const fetcher = () => {
    calls++;
    return Promise.resolve(
      calls === 1
        ? new Response(JSON.stringify({ error: { message: 'The model is overloaded.', details: [{ retryDelay: '7s' }] } }), { status: 503 })
        : reply({ title: 'T', content: '# x' }),
    );
  };
  const r = await combineTexts('p', { apiKey: 'k', fetcher, sleep: async (ms) => void waits.push(ms) });
  assertEquals(r, { title: 'T', content: '# x' });
  assertEquals(calls, 2);
  assertEquals(waits, [7000]);
});

Deno.test('combineTexts desiste depois de 3 recusas e mostra o motivo do Google', async () => {
  const { combineTexts } = await import('./gemini.ts');
  let calls = 0;
  const fetcher = () => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Resource exhausted. Please try again later.' } }), { status: 429 }));
  };
  const e = await assertRejects(() => combineTexts('p', { apiKey: 'k', fetcher, sleep: async () => {} }), RateLimitError);
  assertEquals(calls, 3);
  assertEquals(e.message, 'Gemini ocupado (429): Resource exhausted. Please try again later.');
});

Deno.test('combineTexts não repete depois de demorar demais', async () => {
  const { combineTexts, GeminiTimeoutError } = await import('./gemini.ts');
  let calls = 0;
  const fetcher = () => {
    calls++;
    return Promise.reject(new DOMException('t', 'TimeoutError'));
  };
  await assertRejects(() => combineTexts('p', { apiKey: 'k', fetcher, sleep: async () => {} }), GeminiTimeoutError);
  assertEquals(calls, 1);
});
