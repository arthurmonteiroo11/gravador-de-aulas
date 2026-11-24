import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('useAutosave', () => {
  it('espera a pessoa parar de digitar e salva o texto mais recente', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, 800), { initialProps: { v: '' } });
    rerender({ v: 'a' });
    rerender({ v: 'ab' });
    await act(async () => void vi.advanceTimersByTime(800));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
    expect(result.current).toBe('saved');
  });

  it('não envia dois ao mesmo tempo e termina com o último texto', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { rerender } = renderHook(({ v }) => useAutosave(v, save, 800), { initialProps: { v: '' } });
    rerender({ v: 'um' });
    await act(async () => void vi.advanceTimersByTime(800));
    rerender({ v: 'um dois' });
    await act(async () => void vi.advanceTimersByTime(800));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve());
    expect(save).toHaveBeenLastCalledWith('um dois');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('tenta de novo depois de uma falha', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, 800), { initialProps: { v: '' } });
    rerender({ v: 'x' });
    await act(async () => void vi.advanceTimersByTime(800));
    expect(result.current).toBe('error');
    await act(async () => void vi.advanceTimersByTime(5_000));
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('saved');
  });

  it('salva na hora quando o app vai para o fundo', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ v }) => useAutosave(v, save, 800), { initialProps: { v: '' } });
    rerender({ v: 'rápido' });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(save).toHaveBeenCalledWith('rápido');
  });
});
