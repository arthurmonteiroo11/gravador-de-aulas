import { describe, it, expect, vi } from 'vitest';
import { keepScreenOn } from './wakeLock';

describe('keepScreenOn', () => {
  it('pede para manter a tela acesa e libera ao final', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const stop = await keepScreenOn();
    expect(request).toHaveBeenCalledWith('screen');
    await stop();
    expect(release).toHaveBeenCalled();
  });

  it('não quebra sem suporte', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    const stop = await keepScreenOn();
    await expect(stop()).resolves.toBeUndefined();
  });
});

describe('keepScreenOn — falhas', () => {
  it('avisa quando não consegue manter a tela acesa', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowed'));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const onUnavailable = vi.fn();
    await keepScreenOn(onUnavailable);
    expect(onUnavailable).toHaveBeenCalled();
  });

  it('avisa quando o aparelho não tem o recurso', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    const onUnavailable = vi.fn();
    await keepScreenOn(onUnavailable);
    expect(onUnavailable).toHaveBeenCalled();
  });
});
