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

import { FakeTrack } from './fakes';

describe('getVoiceStream — iOS', () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = (ctxState: string) => {
    const micTrack = new FakeTrack();
    const mic = fakeStream(micTrack);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(mic) },
    });
    const outTrack = new FakeTrack();
    const out = fakeStream(outTrack);
    const ctx = {
      state: ctxState,
      onstatechange: null as null | (() => void),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      createMediaStreamSource: () => ({ connect: vi.fn() }),
      createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, connect: vi.fn() }),
      createMediaStreamDestination: () => ({ stream: out }),
    };
    vi.stubGlobal('AudioContext', function () { return ctx; });
    return { mic, micTrack, out, outTrack, ctx };
  };

  it('retoma o AudioContext e, se continuar suspenso, usa o microfone direto', async () => {
    const { mic, ctx } = setup('suspended');
    const stream = await getVoiceStream({ voiceFilter: true });
    expect(ctx.resume).toHaveBeenCalled();
    expect(stream).toBe(mic);
  });

  it('repassa o mute do microfone para a trilha filtrada', async () => {
    const { micTrack, out, outTrack } = setup('running');
    const stream = await getVoiceStream({ voiceFilter: true });
    expect(stream).toBe(out);
    const onMute = vi.fn();
    outTrack.addEventListener('mute', onMute);
    micTrack.mute();
    expect(onMute).toHaveBeenCalled();
  });

  it('áudio interrompido pelo sistema conta como mute', async () => {
    const { ctx, outTrack } = setup('running');
    await getVoiceStream({ voiceFilter: true });
    const onMute = vi.fn();
    outTrack.addEventListener('mute', onMute);
    ctx.state = 'interrupted';
    ctx.onstatechange?.();
    expect(onMute).toHaveBeenCalled();
  });
});
