/**
 * Web Push sem bibliotecas: chaves VAPID (RFC 8292) e conteúdo criptografado (RFC 8291, aes128gcm).
 * Tudo com WebCrypto, que o Deno das Edge Functions já tem.
 */
export type Bytes = Uint8Array<ArrayBuffer>;
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const enc = new TextEncoder();

export function b64url(bytes: Bytes): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Bytes {
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Bytes[]) => {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Par de chaves novo. A pública vai para o app; a privada fica só no banco, sem acesso pelo app. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64url(raw), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

/** Cabeçalho Authorization do VAPID: um JWT ES256 válido por 12 h para o servidor de push daquele endereço. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** HKDF com uma rodada de expansão (até 32 bytes), como a RFC 8291 usa. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** Criptografa a mensagem para uma inscrição (um registro só, aes128gcm). */
export async function encryptPayload(target: PushTarget, payload: Bytes, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export type PushResult = { ok: boolean; status: number; gone: boolean };

/** Envia uma notificação. "gone": a inscrição não existe mais (app apagado, permissão tirada) e pode ser removida. */
export async function sendPush(
  target: PushTarget,
  message: unknown,
  keys: VapidKeys,
  subject: string,
  fetcher: typeof fetch = fetch,
): Promise<PushResult> {
  const body = await encryptPayload(target, enc.encode(JSON.stringify(message)));
  const res = await fetcher(target.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(target.endpoint, keys, subject),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '43200',
      urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  await res.body?.cancel();
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

/** Texto da notificação do dia. */
export function reminderMessage(due: number) {
  return {
    title: 'Hora de revisar',
    body: due === 1 ? '1 flashcard para hoje. Leva um minuto.' : `${due} flashcards para hoje. Uns minutos e está feito.`,
    url: '/?revisar=1',
  };
}
