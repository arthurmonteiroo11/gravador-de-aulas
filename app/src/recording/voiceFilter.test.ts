import { describe, it, expect, vi, afterEach } from 'vitest';
import { getVoiceStream, HIGHPASS_HZ } from './voiceFilter';
import { fakeStream } from './fakes';

const mockMic = () => {
  const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
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

  it('com filtro passa o som por um passa-alta de 100 Hz', async () => {
    mockMic();
    const filter = { type: '', frequency: { value: 0 }, connect: vi.fn() };
    const out = fakeStream();
    class FakeCtx {
      createMediaStreamSource = () => ({ connect: vi.fn() });
      createBiquadFilter = () => filter;
      createMediaStreamDestination = () => ({ stream: out });
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    const stream = await getVoiceStream({ voiceFilter: true });
    expect(filter.type).toBe('highpass');
    expect(filter.frequency.value).toBe(HIGHPASS_HZ);
    expect(HIGHPASS_HZ).toBe(100);
    expect(stream).toBe(out);
  });
});
