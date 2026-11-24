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
