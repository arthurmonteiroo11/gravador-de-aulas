// Convite de uso único: a pessoa convidada cria a própria conta, sem passar e-mail e senha para ninguém.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;
export const MIN_PASSWORD = 8;

/** "k7qm-4xpa 2b" vira "K7QM4XPA2B". Devolve null se não tiver a cara de um convite. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code) ? code : null;
}

export type Signup = { code: string; email: string; password: string };

export function parseSignup(body: unknown): Signup | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = normalizeCode(b.code);
  if (!code) return 'Código de convite inválido.';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return 'Digite um e-mail válido.';
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} letras ou números.`;
  if (password.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  return { code, email, password };
}

export type RedeemDeps = {
  /** Marca o convite como usado se ainda valer; devolve quem convidou, ou null. */
  claim: (code: string) => Promise<string | null>;
  /** Desfaz a marcação quando a conta não pôde ser criada. */
  release: (code: string) => Promise<void>;
  createUser: (email: string, password: string) => Promise<{ id: string } | { error: string }>;
  addMember: (userId: string, invitedBy: string) => Promise<void>;
  markUsedBy: (code: string, userId: string) => Promise<void>;
};

export type RedeemResult = { ok: true } | { ok: false; status: number; error: string };

export async function redeem(input: Signup, deps: RedeemDeps): Promise<RedeemResult> {
  const invitedBy = await deps.claim(input.code);
  if (!invitedBy) return { ok: false, status: 404, error: 'Este convite não vale mais: já foi usado, venceu ou foi cancelado.' };
  let created: { id: string } | { error: string };
  try {
    created = await deps.createUser(input.email, input.password);
  } catch (e) {
    created = { error: String((e as Error)?.message ?? e) };
  }
  if ('error' in created) {
    await deps.release(input.code);
    const taken = /already|registered|exists/i.test(created.error);
    return taken
      ? { ok: false, status: 409, error: 'Esse e-mail já tem conta. Use outro ou entre com ele.' }
      : { ok: false, status: 400, error: `Não deu para criar a conta: ${created.error.slice(0, 120)}` };
  }
  await deps.addMember(created.id, invitedBy);
  await deps.markUsedBy(input.code, created.id);
  return { ok: true };
}

/** O caminho do áudio tem que ficar na pasta da própria aula: {dono}/{aula}/{parte}. */
export const ownsPath = (path: string, userId: string, lessonId: string) =>
  path.startsWith(`${userId}/${lessonId}/`) && !path.includes('..');
