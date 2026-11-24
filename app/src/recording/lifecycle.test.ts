import { describe, it, expect, vi } from 'vitest';
import { watchLifecycle } from './lifecycle';

const setVisibility = (v: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });

describe('watchLifecycle', () => {
  it('pausa ao esconder a página', () => {
    const rec = { state: 'recording', pause: vi.fn().mockResolvedValue(undefined) };
    const stop = watchLifecycle(rec);
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rec.pause).toHaveBeenCalledTimes(1);
    stop();
    setVisibility('visible');
  });

  it('pausa no pagehide', () => {
    const rec = { state: 'recording', pause: vi.fn().mockResolvedValue(undefined) };
    const stop = watchLifecycle(rec);
    window.dispatchEvent(new Event('pagehide'));
    expect(rec.pause).toHaveBeenCalledTimes(1);
    stop();
  });

  it('não pausa se não está gravando', () => {
    const rec = { state: 'paused', pause: vi.fn() };
    const stop = watchLifecycle(rec);
    window.dispatchEvent(new Event('pagehide'));
    expect(rec.pause).not.toHaveBeenCalled();
    stop();
  });
});
