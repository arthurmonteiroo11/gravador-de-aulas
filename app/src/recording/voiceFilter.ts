export const HIGHPASS_HZ = 100;

const cleanups = new WeakMap<MediaStream, () => void>();

/**
 * Pede o microfone. Com o filtro de voz: redução de ruído e cancelamento de eco
 * do próprio aparelho, mais um passa-alta que corta graves (ar-condicionado, batidas).
 */
export async function getVoiceStream(opts: { voiceFilter: boolean }): Promise<MediaStream> {
  const on = opts.voiceFilter;
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: on, noiseSuppression: on, autoGainControl: on },
  });
  const Ctx = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!on || !Ctx) {
    cleanups.set(mic, () => mic.getTracks().forEach((t) => t.stop()));
    return mic;
  }

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(mic);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = HIGHPASS_HZ;
  const dest = ctx.createMediaStreamDestination();
  source.connect(filter);
  filter.connect(dest);
  const out = dest.stream;

  // Se o sistema cortar o microfone (ligação, Siri), avisa pela trilha filtrada também.
  for (const micTrack of mic.getAudioTracks()) {
    micTrack.addEventListener('ended', () => {
      for (const t of out.getAudioTracks()) t.dispatchEvent(new Event('ended'));
    });
  }
  cleanups.set(out, () => {
    mic.getTracks().forEach((t) => t.stop());
    void ctx.close?.();
  });
  return out;
}

/** Libera o microfone e o processamento de áudio. */
export function releaseVoiceStream(stream: MediaStream): void {
  cleanups.get(stream)?.();
  cleanups.delete(stream);
}
