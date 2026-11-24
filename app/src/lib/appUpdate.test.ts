import { describe, it, expect, vi } from 'vitest';
import { createAppUpdater } from './appUpdate';

describe('createAppUpdater', () => {
  it('aplica a versão nova na hora quando não está gravando', () => {
    const apply = vi.fn();
    const u = createAppUpdater(apply);
    u.onNeedRefresh();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('espera a gravação acabar para atualizar', () => {
    const apply = vi.fn();
    const u = createAppUpdater(apply);
    u.setRecording(true);
    u.onNeedRefresh();
    expect(apply).not.toHaveBeenCalled();
    u.setRecording(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('não atualiza sem versão nova', () => {
    const apply = vi.fn();
    const u = createAppUpdater(apply);
    u.setRecording(true);
    u.setRecording(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
