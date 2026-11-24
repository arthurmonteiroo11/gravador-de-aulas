type Sentinel = { release: () => Promise<void> };

/**
 * Mantém a tela acesa enquanto grava. Reaplica ao voltar para a página.
 * `onUnavailable` é chamado quando o aparelho recusa (ex.: iOS antigo no app da tela inicial).
 */
export async function keepScreenOn(onUnavailable?: () => void): Promise<() => Promise<void>> {
  const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
  if (!wakeLock) {
    onUnavailable?.();
    return async () => undefined;
  }

  let sentinel: Sentinel | null = null;
  const acquire = async () => {
    try {
      sentinel = await wakeLock.request('screen');
    } catch {
      sentinel = null;
      onUnavailable?.();
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void acquire();
  };

  await acquire();
  document.addEventListener('visibilitychange', onVisible);
  return async () => {
    document.removeEventListener('visibilitychange', onVisible);
    await sentinel?.release();
    sentinel = null;
  };
}
