/** Roda `tick` a cada `ms`, nunca duas rodadas ao mesmo tempo. */
export function startPoller(tick: () => Promise<void>, ms: number): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch {
      /* tenta de novo na próxima rodada */
    } finally {
      running = false;
    }
  }, ms);
  return () => clearInterval(timer);
}
