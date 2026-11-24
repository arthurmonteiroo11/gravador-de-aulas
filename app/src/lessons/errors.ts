type ServerError = { message: string; code?: string };

const isServerError = (err: unknown): err is ServerError =>
  typeof err === 'object' && err !== null && !(err instanceof TypeError) && typeof (err as ServerError).message === 'string';

/** Texto do erro do servidor, ou null quando o problema é falta de internet. */
export function serverErrorDetail(err: unknown): string | null {
  if (!isServerError(err) || /fetch|load failed|network/i.test(err.message)) return null;
  return err.code ? `${err.message} (${err.code})` : err.message;
}

/** Separa falta de internet de erro do servidor, para o aviso dizer o que realmente aconteceu. */
export function describeLoadError(err: unknown): string {
  const detail = serverErrorDetail(err);
  return detail ? `Erro do servidor: ${detail}` : 'Sem conexão. Mostrando quando a internet voltar.';
}
