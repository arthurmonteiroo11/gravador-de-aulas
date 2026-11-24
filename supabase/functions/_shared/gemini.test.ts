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
  const r = await combineTexts('p', { apiKey: 'k', fetcher, fallbacks: [], sleep: async (ms) => void waits.push(ms) });
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
  const e = await assertRejects(() => combineTexts('p', { apiKey: 'k', fetcher, fallbacks: [], sleep: async () => {} }), RateLimitError);
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
  await assertRejects(() => combineTexts('p', { apiKey: 'k', fetcher, fallbacks: [], sleep: async () => {} }), GeminiTimeoutError);
  assertEquals(calls, 1);
});

Deno.test('503 no modelo principal passa para o reserva', async () => {
  const urls: string[] = [];
  const fetcher = (url: string | URL | Request) => {
    urls.push(String(url));
    return Promise.resolve(
      urls.length === 1
        ? new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 })
        : reply({ rewrite: '# A', summary: '- b' }),
    );
  };
  const r = await rewriteAndSummarize('t', { apiKey: 'k', fetcher, model: 'principal', fallbacks: ['reserva-1', 'reserva-2'] });
  assertEquals(r, { rewrite: '# A', summary: '- b' });
  assertEquals(urls.map((u) => u.split('/models/')[1].split(':')[0]), ['principal', 'reserva-1']);
});

Deno.test('reserva que não existe é pulado e cota esgotada também troca de modelo', async () => {
  const urls: string[] = [];
  const fetcher = (url: string | URL | Request) => {
    urls.push(String(url));
    if (urls.length === 1) return Promise.resolve(new Response('You exceeded your current quota', { status: 429 }));
    if (urls.length === 2) return Promise.resolve(new Response('{"error":{"message":"not found"}}', { status: 404 }));
    return Promise.resolve(reply([{ part: 0, start: 0, end: 1, text: 'oi' }]));
  };
  const segs = await transcribeBlock([], { apiKey: 'k', fetcher, model: 'a', fallbacks: ['b', 'c'] });
  assertEquals(segs.length, 1);
  assertEquals(urls.length, 3);
});

Deno.test('demora no principal não troca de modelo', async () => {
  let calls = 0;
  const fetcher = () => {
    calls++;
    return Promise.reject(new DOMException('t', 'TimeoutError'));
  };
  await assertRejects(() => transcribeBlock([], { apiKey: 'k', fetcher, model: 'a', fallbacks: ['b'] }), RateLimitError);
  assertEquals(calls, 1);
});

Deno.test('todos sobrecarregados: devolve o erro do principal', async () => {
  const fetcher = () => Promise.resolve(new Response('{"error":{"message":"high demand"}}', { status: 503 }));
  const e = await assertRejects(() => transcribeBlock([], { apiKey: 'k', fetcher, model: 'a', fallbacks: ['b'] }), RateLimitError);
  assertEquals((e as RateLimitError).status, 503);
  assertEquals((e as RateLimitError).reason, 'high demand');
});

Deno.test('contexto da matéria vai no começo da transcrição e da reescrita', async () => {
  const bodies: any[] = [];
  const fetcher = (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(reply(bodies.length === 1 ? [] : { rewrite: 'r', summary: 's' }));
  };
  const context = 'Contexto da aula:\n- Matéria: Cálculo I.';
  await transcribeBlock([{ data: new Uint8Array([1]), mimeType: 'audio/mp4' }], { apiKey: 'k', fetcher, context });
  await rewriteAndSummarize('[00:00] oi', { apiKey: 'k', fetcher, context });
  for (const b of bodies) assertEquals(b.contents[0].parts[0].text.startsWith(context), true);
  await transcribeBlock([], { apiKey: 'k', fetcher: (_u, init) => { bodies.push(JSON.parse(String(init?.body))); return Promise.resolve(reply([])); } });
  assertEquals(bodies[2].contents[0].parts[0].text.startsWith('Você vai receber'), true);
});
