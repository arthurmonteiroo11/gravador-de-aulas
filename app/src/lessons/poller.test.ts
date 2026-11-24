import { describe, it, expect, vi, afterEach } from 'vitest';
import { startPoller } from './poller';

describe('startPoller', () => {
  afterEach(() => vi.useRealTimers());

  it('não começa uma rodada enquanto a anterior não terminou', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const tick = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const stop = startPoller(tick, 10_000);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(tick).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it('erro numa rodada não para as próximas', async () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockRejectedValueOnce(new Error('rede')).mockResolvedValue(undefined);
    const stop = startPoller(tick, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });
});
