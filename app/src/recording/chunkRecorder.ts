export type RecordedChunk = { idx: number; blob: Blob; startS: number; durationS: number };
export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

type Options = {
  chunkMs?: number;
  createRecorder?: (stream: MediaStream, mimeType: string | undefined) => MediaRecorder;
};

const PREFERRED_MIME = 'audio/mp4';

const pickMimeType = (): string | undefined =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(PREFERRED_MIME) ? PREFERRED_MIME : undefined;

const defaultCreateRecorder = (stream: MediaStream, mimeType: string | undefined) =>
  new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

/**
 * Grava em partes independentes: cada parte é um MediaRecorder novo, para que
 * cada arquivo seja tocável e enviável sozinho. Pausas não contam no tempo.
 */
export class ChunkRecorder {
  state: RecorderState = 'idle';
  private recorder: MediaRecorder | null = null;
  private segmentStartedAt = 0;
  private accumulatedMs = 0;
  private nextIdx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
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
    const running = this.state === 'recording' ? Date.now() - this.segmentStartedAt : 0;
    return Math.round((this.accumulatedMs + running) / 1000);
  }

  /** Quantas partes já foram fechadas (emitidas ou em emissão). */
  get chunkCount(): number {
    return this.nextIdx;
  }

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'recording';
    this.startSegment();
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    await this.finishSegment();
  }

  resume(stream: MediaStream): void {
    if (this.state !== 'paused') return;
    this.stream = stream;
    this.state = 'recording';
    this.startSegment();
  }

  async stop(): Promise<void> {
    const wasRecording = this.state === 'recording';
    this.state = 'stopped';
    if (wasRecording) await this.finishSegment();
  }

  private startSegment(): void {
    this.watchTracks(this.stream);
    this.recorder = this.createRecorder(this.stream, this.mimeType);
    this.recorder.start();
    this.segmentStartedAt = Date.now();
    this.timer = setTimeout(() => void this.rotate(), this.chunkMs);
  }

  private async rotate(): Promise<void> {
    if (this.state !== 'recording') return;
    await this.finishSegment();
    if (this.state === 'recording') this.startSegment();
  }

  private finishSegment(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve();
    this.recorder = null;

    const elapsedMs = Date.now() - this.segmentStartedAt;
    const startS = this.accumulatedMs / 1000;
    this.accumulatedMs += elapsedMs;
    const idx = this.nextIdx++;

    return new Promise((resolve) => {
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) parts.push(e.data);
      };
      recorder.onstop = () => {
        const type = parts[0]?.type || recorder.mimeType || PREFERRED_MIME;
        this.onChunk({ idx, blob: new Blob(parts, { type }), startS, durationS: elapsedMs / 1000 });
        resolve();
      };
      recorder.stop();
    });
  }

  private watchTracks(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => void this.pause(), { once: true });
    }
  }
}
