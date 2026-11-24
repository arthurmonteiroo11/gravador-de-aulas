// Dublês de teste para APIs de mídia do navegador.
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/mp4';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  /** Conteúdo da próxima parte ('' simula parte vazia). */
  static nextData = 'x';
  stop() {
    // Como no navegador: parar um gravador já inativo não faz nada.
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const data = FakeMediaRecorder.nextData;
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(data ? [data] : [], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
  /** O sistema encerra o gravador sozinho (microfone tomado por outro app). */
  selfStop() {
    this.stop();
  }
}

export class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  stop() {
    this.readyState = 'ended';
  }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
  mute() {
    this.dispatchEvent(new Event('mute'));
  }
}

export function fakeStream(track = new FakeTrack()): MediaStream {
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
}
