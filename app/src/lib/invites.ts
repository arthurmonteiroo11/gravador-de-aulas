import { supabase } from './supabase';
import { combineError } from '../lessons/study';

// Mesmo alfabeto da função: sem 0/O e 1/I/L, que se confundem ao ditar o código.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;
export const MIN_PASSWORD = 8;
export const INVITE_DAYS = 7;

export type Invite = { code: string; created_at: string; expires_at: string; used_at: string | null };

export function newCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  // 32 letras: cada byte vira uma letra sem viés (256 é múltiplo de 32).
  return Array.from(random(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** "K7QM4XPA2B" vira "K7QM-4XPA-2B", mais fácil de ler em voz alta. */
export const formatCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code) ? code : null;
}

export const inviteLink = (code: string, origin = window.location.origin) => `${origin}/?convite=${code}`;

export async function createInvite(): Promise<Invite> {
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('invites')
    .insert({ code: newCode(), expires_at: expires })
    .select('code, created_at, expires_at, used_at')
    .single();
  if (error) throw new Error(/relation|does not exist|schema cache/i.test(error.message)
    ? 'Os convites ainda não estão prontos no servidor. Rode o SQL dos convites.'
    : 'Não deu para criar o convite. Verifique a internet.');
  return data as Invite;
}

/** Convites ainda abertos (nem usados, nem vencidos) e os usados, para ver quem já entrou. */
export async function listInvites(): Promise<Invite[]> {
  const { data, error } = await supabase.from('invites').select('code, created_at, expires_at, used_at').order('created_at', { ascending: false }).limit(20);
  if (error) return [];
  return (data ?? []) as Invite[];
}

export async function cancelInvite(code: string): Promise<void> {
  const { error } = await supabase.from('invites').delete().eq('code', code);
  if (error) throw new Error('Não deu para cancelar o convite.');
}

export const inviteOpen = (i: Invite, now = Date.now()) => !i.used_at && Date.parse(i.expires_at) > now;

/** Cria a conta com o convite e já entra nela. */
export async function signUpWithInvite(code: string, email: string, password: string): Promise<void> {
  const { error } = await supabase.functions.invoke('process-lesson', { body: { signup: { code, email, password } } });
  if (error) throw new Error(await combineError(error, 'Não deu para criar a conta. Verifique a internet.'));
  const signIn = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (signIn.error) throw new Error('A conta foi criada, mas não deu para entrar agora. Tente entrar com o e-mail e a senha.');
}

export async function shareInvite(code: string): Promise<'shared' | 'copied'> {
  const link = inviteLink(code);
  const text = `Use este convite para criar sua conta no app de aulas: ${link}\nCódigo: ${formatCode(code)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Convite', text });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
