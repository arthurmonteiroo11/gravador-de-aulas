/**
 * Pede o microfone. Com o filtro de voz, o próprio aparelho reduz ruído, corta eco
 * e equilibra o volume. Sem Web Audio no meio: no iPhone, gravar a saída de um
 * AudioContext gerava arquivos mudos.
 */
export async function getVoiceStream(opts: { voiceFilter: boolean }): Promise<MediaStream> {
  const on = opts.voiceFilter;
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: on, noiseSuppression: on, autoGainControl: on },
  });
}

/** Libera o microfone. */
export function releaseVoiceStream(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}
