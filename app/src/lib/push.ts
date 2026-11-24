import { supabase } from './supabase';
import { combineError } from '../lessons/study';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/** No iPhone, aviso só existe com o app aberto pela Tela de Início. */
export async function pushState(): Promise<PushState> {
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!hasApi) return isIos() && !standalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function call(body: Record<string, unknown>, fallback: string) {
  const { data, error } = await supabase.functions.invoke('process-lesson', { body });
  if (error) throw new Error(await combineError(error, fallback));
  return data as Record<string, unknown>;
}

/** Pede permissão, inscreve o aparelho e guarda a inscrição. Precisa vir de um toque da pessoa. */
export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Sem permissão para avisos. Ative em Ajustes > Notificações > Aulas.');
  const { publicKey } = await call({ pushKey: true }, 'Não deu para ativar o lembrete. Verifique a internet.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(String(publicKey)) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, origin: window.location.origin },
    { onConflict: 'endpoint' },
  );
  if (error) {
    await sub.unsubscribe().catch(() => {});
    throw new Error('Não deu para ativar o lembrete. Verifique a internet.');
  }
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush(): Promise<void> {
  await call({ testPush: true }, 'Não deu para enviar o teste. Verifique a internet.');
}
