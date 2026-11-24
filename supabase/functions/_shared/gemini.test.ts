import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { transcribeBlock, rewriteAndSummarize, RateLimitError } from './gemini.ts';

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
