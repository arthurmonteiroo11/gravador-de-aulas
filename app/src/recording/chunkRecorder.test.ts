import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChunkRecorder, type RecordedChunk } from './chunkRecorder';
import { FakeMediaRecorder, FakeTrack, fakeStream } from './fakes';

const make = (stream = fakeStream()) => {
  const chunks: RecordedChunk[] = [];
  const rec = new ChunkRecorder(stream, (c) => chunks.push(c), {
    createRecorder: (s) => new FakeMediaRecorder(s) as unknown as MediaRecorder,
  });
  return { rec, chunks };
};

describe('ChunkRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('emite parte a cada 60 s com idx e startS crescentes', async () => {
    const { rec, chunks } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(chunks.map(({ idx, startS, durationS }) => ({ idx, startS, durationS }))).toEqual([
      { idx: 0, startS: 0, durationS: 60 },
      { idx: 1, startS: 60, durationS: 60 },
    ]);
  });

  it('cada parte usa um gravador novo (arquivo independente)', async () => {
    const { rec } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(FakeMediaRecorder.instances).toHaveLength(3);
  });

  it('pause salva a parte parcial', async () => {
    const { rec, chunks } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await rec.pause();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ idx: 0, startS: 0, durationS: 30 });
    expect(rec.state).toBe('paused');
  });

  it('resume continua a contagem', async () => {
    const { rec, chunks } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await rec.pause();
    rec.resume(fakeStream());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chunks[1]).toMatchObject({ idx: 1, startS: 30, durationS: 60 });
  });

  it('pausa não conta tempo', async () => {
    const { rec } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await rec.pause();
    const before = rec.recordedS;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(rec.recordedS).toBe(before);
    expect(before).toBe(10);
  });

  it('microfone cortado pelo sistema (ligação, Siri) pausa e salva a parte', async () => {
    const track = new FakeTrack();
    const { rec, chunks } = make(fakeStream(track));
    rec.start();
    await vi.advanceTimersByTimeAsync(20_000);
    track.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.state).toBe('paused');
    expect(chunks[0]).toMatchObject({ idx: 0, durationS: 20 });
  });

  it('stop salva a última parte e encerra', async () => {
    const { rec, chunks } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(70_000);
    await rec.stop();
    expect(chunks.map((c) => c.durationS)).toEqual([60, 10]);
    expect(rec.state).toBe('stopped');
  });
});

import { recorderOptions, AUDIO_BITS_PER_SECOND } from './chunkRecorder';

describe('recorderOptions', () => {
  it('usa 48 kbps para caber 1h30 no armazenamento grátis', () => {
    expect(AUDIO_BITS_PER_SECOND).toBe(48_000);
    expect(recorderOptions('audio/mp4')).toEqual({ mimeType: 'audio/mp4', audioBitsPerSecond: 48_000 });
    expect(recorderOptions(undefined)).toEqual({ audioBitsPerSecond: 48_000 });
  });
});

describe('ChunkRecorder — interrupções do sistema', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.nextData = 'x';
  });
  afterEach(() => vi.useRealTimers());

  it('gravador que para sozinho salva a parte e pausa, sem travar', async () => {
    const track = new FakeTrack();
    const { rec, chunks } = make(fakeStream(track));
    rec.start();
    await vi.advanceTimersByTimeAsync(20_000);
    FakeMediaRecorder.instances[0].selfStop();
    await vi.advanceTimersByTimeAsync(0);
    track.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ idx: 0, durationS: 20 });
    expect(rec.state).toBe('paused');
    expect(rec.chunkCount).toBe(1);
    await rec.stop(); // não pode travar
    expect(rec.state).toBe('stopped');
  });

  it('microfone silenciado pelo iOS (mute) pausa e salva a parte', async () => {
    const track = new FakeTrack();
    const { rec, chunks } = make(fakeStream(track));
    rec.start();
    await vi.advanceTimersByTimeAsync(15_000);
    track.mute();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(rec.state).toBe('paused');
    expect(rec.pauseReason).toBe('mute');
    expect(chunks[0]).toMatchObject({ idx: 0, durationS: 16.5 });
  });

  it('silêncio rápido do iOS (mute e unmute logo em seguida) não pausa', async () => {
    const track = new FakeTrack();
    const { rec } = make(fakeStream(track));
    rec.start();
    await vi.advanceTimersByTimeAsync(5_000);
    track.mute();
    await vi.advanceTimersByTimeAsync(300);
    track.unmute();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rec.state).toBe('recording');
  });

  it('evento do microfone antigo não pausa a gravação retomada', async () => {
    const oldTrack = new FakeTrack();
    const { rec } = make(fakeStream(oldTrack));
    rec.start();
    await vi.advanceTimersByTimeAsync(3_000);
    await rec.pause();
    rec.resume(fakeStream(new FakeTrack()));
    oldTrack.end();
    oldTrack.mute();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rec.state).toBe('recording');
    expect(rec.recordedS).toBe(8);
  });

  it('parte vazia não é emitida nem contada', async () => {
    const { rec, chunks } = make();
    rec.start();
    FakeMediaRecorder.nextData = '';
    await rec.pause();
    expect(chunks).toHaveLength(0);
    expect(rec.chunkCount).toBe(0);
    FakeMediaRecorder.nextData = 'x';
    rec.resume(fakeStream());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chunks[0]).toMatchObject({ idx: 0 });
  });
});

describe('ChunkRecorder — pausa durante a troca de parte', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.nextData = 'x';
  });
  afterEach(() => vi.useRealTimers());

  it('pausa pedida no meio da troca continua pausada', async () => {
    const { rec } = make();
    rec.start();
    await vi.advanceTimersByTimeAsync(59_999);
    vi.advanceTimersByTime(1); // dispara a troca sem esperar
    await rec.pause();
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.state).toBe('paused');
    expect(FakeMediaRecorder.instances.filter((r) => r.state === 'recording')).toHaveLength(0);
  });
});
