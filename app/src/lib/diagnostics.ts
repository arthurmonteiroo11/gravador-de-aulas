type Kind = 'upload' | 'processing';
const last: Record<Kind, string | null> = { upload: null, processing: null };

/** Guarda o último erro de envio e de processamento para mostrar na tela da aula. null limpa. */
export function recordProblem(kind: Kind, text: string | null): void {
  last[kind] = text;
}

export function lastProblems(): Record<Kind, string | null> {
  return { ...last };
}

type WithContext = { message?: string; code?: string; context?: { status?: number; text?: () => Promise<string> } };

/** Texto útil de qualquer erro do Supabase, incluindo o corpo da resposta de uma Edge Function. */
export async function errorText(err: unknown): Promise<string> {
  const e = (typeof err === 'object' && err !== null ? err : { message: String(err) }) as WithContext;
  const ctx = e.context;
  if (ctx && typeof ctx.status === 'number' && typeof ctx.text === 'function') {
    const body = await ctx.text().catch(() => '');
    return `${ctx.status} ${body}`.trim().slice(0, 300);
  }
  const message = e.message ?? String(err);
  return e.code ? `${message} (${e.code})` : message;
}
