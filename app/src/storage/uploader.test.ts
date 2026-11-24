import { describe, it, expect, vi, beforeEach } from 'vitest';
import { putChunk, listPending, removeChunk } from './localQueue';
import { uploadPending, chunkPath } from './uploader';
import { lastProblems } from '../lib/diagnostics';

const fakeClient = (opts: { uploadError?: boolean; upsertError?: boolean } = {}) => {
  const upload = vi.fn().mockResolvedValue({ error: opts.uploadError ? { message: 'rede' } : null });
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ? { message: 'db' } : null });
  return {
    client: { storage: { from: () => ({ upload }) }, from: () => ({ upsert }) },
    upload,
    upsert,
  };
};

describe('uploadPending', () => {
  beforeEach(async () => {
    for (const c of await listPending()) await removeChunk(c.lessonId, c.idx);
    await putChunk({ lessonId: 'l1', idx: 0, blob: new Blob(['a'], { type: 'audio/mp4' }), startS: 0, durationS: 60 });
  });

  it('envio ok remove da fila', async () => {
    const { client, upload, upsert } = fakeClient();
    expect(await uploadPending('u1', client as never)).toEqual({ uploaded: 1, failed: 0 });
    expect(upload).toHaveBeenCalledWith('u1/l1/0.m4a', expect.any(Blob), { upsert: true, contentType: 'audio/mp4' });
    expect(upsert).toHaveBeenCalledWith({
      lesson_id: 'l1', idx: 0, start_s: 0, duration_s: 60, path: 'u1/l1/0.m4a', mime_type: 'audio/mp4',
    });
    expect(await listPending()).toEqual([]);
  });

  it('falha mantém na fila', async () => {
    const { client } = fakeClient({ uploadError: true });
    expect(await uploadPending('u1', client as never)).toEqual({ uploaded: 0, failed: 1 });
    expect(await listPending()).toHaveLength(1);
    expect(lastProblems().upload).toBe('rede');
  });

  it('envio que trava não prende a fila: vira erro e libera a próxima rodada', async () => {
    const upload = vi.fn(() => new Promise(() => undefined));
    const client = { storage: { from: () => ({ upload }) }, from: () => ({ upsert: vi.fn() }) };
    expect(await uploadPending('u1', client as never, { timeoutMs: 20 })).toEqual({ uploaded: 0, failed: 1 });
    expect(lastProblems().upload).toMatch(/demorou demais/);
  });

  it('nunca remove antes de gravar a linha', async () => {
    const { client } = fakeClient({ upsertError: true });
    await uploadPending('u1', client as never);
    expect(await listPending()).toHaveLength(1);
  });

  it('caminho usa webm quando o formato não é mp4', () => {
    expect(chunkPath('u', 'l', 3, 'audio/webm;codecs=opus')).toBe('u/l/3.webm');
  });
});
