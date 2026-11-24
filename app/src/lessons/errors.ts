type ServerError = { message: string; code?: string };

const isServerError = (err: unknown): err is ServerError =>
  typeof err === 'object' && err !== null && !(err instanceof TypeError) && typeof (err as ServerError).message === 'string';

/** Separa falta de internet de erro do servidor, para o aviso dizer o que realmente aconteceu. */
export function describeLoadError(err: unknown): string {
  if (!isServerError(err) || /fetch|load failed|network/i.test(err.message)) {
    return 'Sem conexão. Mostrando quando a internet voltar.';
  }
  return err.code ? `Erro do servidor: ${err.message} (${err.code})` : `Erro do servidor: ${err.message}`;
}
