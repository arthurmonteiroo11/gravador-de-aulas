export type RecordedChunk = { idx: number; blob: Blob; startS: number; durationS: number };
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
/** Por que a gravação pausou: pedido da pessoa, microfone encerrado/silenciado ou gravador parado pelo sistema. */
export type PauseReason = 'user' | 'ended' | 'mute' | 'recorder-stopped';

/** O iOS silencia o microfone por instantes ao trocar o áudio; só pausa se o silêncio durar isso. */
export const MUTE_GRACE_MS = 1_500;

type Options = {
  chunkMs?: number;
  createRecorder?: (stream: MediaStream, mimeType: string | undefined) => MediaRecorder;
};

const PREFERRED_MIME = 'audio/mp4';

const pickMimeType = (): string | undefined =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(PREFERRED_MIME) ? PREFERRED_MIME : undefined;

/** 48 kbps: voz clara e ~32 MB por aula de 1h30, cabendo no armazenamento grátis. */
export const AUDIO_BITS_PER_SECOND = 48_000;

export const recorderOptions = (mimeType: string | undefined): MediaRecorderOptions =>
  mimeType ? { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND } : { audioBitsPerSecond: AUDIO_BITS_PER_SECOND };

const defaultCreateRecorder = (stream: MediaStream, mimeType: string | undefined) =>
  new MediaRecorder(stream, recorderOptions(mimeType));

/**
 * Grava em partes independentes: cada parte é um MediaRecorder novo, para que
 * cada arquivo seja tocável e enviável sozinho. Pausas não contam no tempo.
 */
type Segment = { recorder: MediaRecorder; startedAt: number; done: Promise<void>; requested: boolean };

/**
 * Grava em partes independentes: cada parte é um MediaRecorder novo, para que
 * cada arquivo seja tocável e enviável sozinho. Pausas não contam no tempo.
 * Se o sistema cortar ou silenciar o microfone, a parte é salva e a gravação pausa.
 */
export class ChunkRecorder {
  state: RecorderState = 'idle';
  pauseReason: PauseReason | null = null;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private segment: Segment | null = null;
  private accumulatedMs = 0;
  private nextIdx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly watched = new WeakSet<MediaStreamTrack>();
  private readonly chunkMs: number;
  private readonly createRecorder: NonNullable<Options['createRecorder']>;
  private readonly mimeType = pickMimeType();

  constructor(
    private stream: MediaStream,
    private readonly onChunk: (chunk: RecordedChunk) => void,
    options: Options = {},
  ) {
    this.chunkMs = options.chunkMs ?? 60_000;
    this.createRecorder = options.createRecorder ?? defaultCreateRecorder;
  }

  get recordedS(): number {
    const running = this.state === 'recording' && this.segment ? Date.now() - this.segment.startedAt : 0;
    return Math.round((this.accumulatedMs + running) / 1000);
  }

  /** Quantas partes com áudio já foram salvas. */
  get chunkCount(): number {
    return this.nextIdx;
  }

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'recording';
    this.startSegment();
  }

  async pause(reason: PauseReason = 'user'): Promise<void> {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    this.pauseReason = reason;
    this.clearMuteTimer();
    await this.finishSegment();
  }

  resume(stream: MediaStream): void {
    if (this.state !== 'paused') return;
    this.stream = stream;
    this.state = 'recording';
    this.pauseReason = null;
    this.startSegment();
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
    await this.finishSegment();
  }

  private startSegment(): void {
    this.watchTracks(this.stream);
    const recorder = this.createRecorder(this.stream, this.mimeType);
    const startedAt = Date.now();
    const parts: Blob[] = [];
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    const segment: Segment = { recorder, startedAt, done, requested: false };

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    // Ligado desde o início: pega também quando o sistema para o gravador sozinho.
    recorder.onstop = () => {
      this.closeSegment(segment, parts);
      resolveDone();
    };

    this.segment = segment;
    recorder.start();
    this.timer = setTimeout(() => void this.rotate(), this.chunkMs);
  }

  private closeSegment(segment: Segment, parts: Blob[]): void {
    const elapsedMs = Date.now() - segment.startedAt;
    const startS = this.accumulatedMs / 1000;
    this.accumulatedMs += elapsedMs;
    if (this.segment === segment) {
      this.segment = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      // Parada que ninguém pediu (o sistema encerrou o gravador): vira pausa.
      if (!segment.requested && this.state === 'recording') {
        this.state = 'paused';
        this.pauseReason = 'recorder-stopped';
      }
    }
    const blob = new Blob(parts, { type: parts[0]?.type || segment.recorder.mimeType || PREFERRED_MIME });
    if (blob.size === 0) return;
    this.onChunk({ idx: this.nextIdx++, blob, startS, durationS: elapsedMs / 1000 });
  }

  private async rotate(): Promise<void> {
    if (this.state !== 'recording') return;
    await this.finishSegment();
    if (this.state === 'recording' && !this.segment) this.startSegment();
  }

  private async finishSegment(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const segment = this.segment;
    if (!segment) return;
    segment.requested = true;
    if (segment.recorder.state !== 'inactive') segment.recorder.stop();
    await segment.done;
  }

  private watchTracks(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      if (this.watched.has(track)) continue;
      this.watched.add(track);
      // Só vale para o microfone em uso: o antigo, de antes da pausa, ainda pode disparar eventos.
      const isCurrent = () => this.stream.getAudioTracks().includes(track);
      track.addEventListener('ended', () => {
        if (isCurrent()) void this.pause('ended');
      });
      track.addEventListener('mute', () => {
        if (!isCurrent() || this.muteTimer) return;
        this.muteTimer = setTimeout(() => {
          this.muteTimer = null;
          if (isCurrent()) void this.pause('mute');
        }, MUTE_GRACE_MS);
      });
      track.addEventListener('unmute', () => this.clearMuteTimer());
    }
  }

  private clearMuteTimer(): void {
    if (this.muteTimer) clearTimeout(this.muteTimer);
    this.muteTimer = null;
  }
}
