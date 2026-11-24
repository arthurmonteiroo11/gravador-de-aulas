import { describe, it, expect, vi, afterEach } from 'vitest';
import { getVoiceStream, releaseVoiceStream } from './voiceFilter';
import { FakeTrack, fakeStream } from './fakes';

const mockMic = (stream = fakeStream()) => {
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return getUserMedia;
};

describe('getVoiceStream', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('com filtro pede redução de ruído e cancelamento de eco', async () => {
    const getUserMedia = mockMic();
    await getVoiceStream({ voiceFilter: true });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('sem filtro desliga os processamentos', async () => {
    const getUserMedia = mockMic();
    await getVoiceStream({ voiceFilter: false });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  });

  it('grava direto do microfone, sem Web Audio (no iPhone ele gravava silêncio)', async () => {
    const mic = fakeStream();
    mockMic(mic);
    const ctx = vi.fn();
    vi.stubGlobal('AudioContext', ctx);
    expect(await getVoiceStream({ voiceFilter: true })).toBe(mic);
    expect(ctx).not.toHaveBeenCalled();
  });

  it('liberar desliga o microfone', async () => {
    const track = new FakeTrack();
    mockMic(fakeStream(track));
    const stream = await getVoiceStream({ voiceFilter: true });
    releaseVoiceStream(stream);
    expect(track.readyState).toBe('ended');
  });
});
