import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { type Bytes, b64url, encryptPayload, fromB64url, generateVapidKeys, reminderMessage, sendPush, vapidAuthorization } from './webpush.ts';

const dec = new TextDecoder();

/** O lado do aparelho: gera a inscrição e decifra como o navegador faria (RFC 8291). */
async function fakeBrowser() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const hmac = async (key: Bytes, data: Bytes) =>
    new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
  const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, n: number) => (await hmac(await hmac(salt, ikm), new Uint8Array([...info, 1]))).slice(0, n);
  const te = new TextEncoder();
  async function decrypt(body: Bytes): Promise<string> {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    assertEquals(rs, 4096);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256));
    const ikm = await hkdf(auth, shared, new Uint8Array([...te.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
    assertEquals(plain[plain.length - 1], 2);
    return dec.decode(plain.slice(0, -1));
  }
  return { target: { endpoint: 'https://web.push.apple.com/QAbc123', p256dh: b64url(uaPublic), auth: b64url(auth) }, decrypt };
}

Deno.test('base64url ida e volta', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(65));
  assertEquals(fromB64url(b64url(bytes)), bytes);
});

Deno.test('o aparelho consegue decifrar a mensagem', async () => {
  const phone = await fakeBrowser();
  const body = await encryptPayload(phone.target, new TextEncoder().encode('{"title":"Hora de revisar"}'));
  assertEquals(await phone.decrypt(body), '{"title":"Hora de revisar"}');
});

Deno.test('JWT do VAPID: assinatura válida com a chave pública, para o servidor certo', async () => {
  const keys = await generateVapidKeys();
  const auth = await vapidAuthorization('https://web.push.apple.com/QAbc', keys, 'https://aulas.exemplo.app', Date.parse('2026-11-24T11:00:00Z'));
  const m = auth.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
  assert(m, auth);
  const claims = JSON.parse(dec.decode(fromB64url(m[2])));
  assertEquals(claims.aud, 'https://web.push.apple.com');
  assertEquals(claims.sub, 'https://aulas.exemplo.app');
  assertEquals(claims.exp, Date.parse('2026-11-24T11:00:00Z') / 1000 + 12 * 3600);
  const pub = await crypto.subtle.importKey('raw', fromB64url(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)));
});

Deno.test('envio: cabeçalhos certos e inscrição vencida marcada para apagar', async () => {
  const phone = await fakeBrowser();
  const keys = await generateVapidKeys();
  let sent: { url: string; init: RequestInit } | null = null;
  const fetcher = ((url: string, init: RequestInit) => { sent = { url, init }; return Promise.resolve(new Response('', { status: 201 })); }) as unknown as typeof fetch;
  const r = await sendPush(phone.target, reminderMessage(3), keys, 'https://aulas.exemplo.app', fetcher);
  assertEquals(r, { ok: true, status: 201, gone: false });
  const h = sent!.init.headers as Record<string, string>;
  assertEquals(h['content-encoding'], 'aes128gcm');
  assertStringIncludes(h.authorization, 'vapid t=');
  assertStringIncludes(await phone.decrypt(sent!.init.body as Bytes), '3 flashcards para hoje');
  const gone = await sendPush(phone.target, {}, keys, 'https://a.b', (() => Promise.resolve(new Response('', { status: 410 }))) as unknown as typeof fetch);
  assertEquals(gone.gone, true);
});

Deno.test('texto do lembrete no singular e no plural', () => {
  assertStringIncludes(reminderMessage(1).body, '1 flashcard para hoje');
  assertStringIncludes(reminderMessage(12).body, '12 flashcards');
});
