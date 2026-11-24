import { describe, it, expect, beforeEach } from 'vitest';
import { putChunk, listPending, removeChunk, closeQueue, dropConnectionForTest } from './localQueue';

const chunk = (lessonId: string, idx: number) => ({
  lessonId, idx, blob: new Blob(['a'], { type: 'audio/mp4' }), startS: idx * 60, durationS: 60,
});

describe('localQueue', () => {
  beforeEach(async () => {
    for (const c of await listPending()) await removeChunk(c.lessonId, c.idx);
  });

  it('parte salva sobrevive a reabrir o banco', async () => {
    await putChunk(chunk('l1', 0));
    await closeQueue();
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ lessonId: 'l1', idx: 0, startS: 0, durationS: 60 });
  });

  it('volta a funcionar quando o iOS derruba a conexão do banco', async () => {
    await putChunk(chunk('l1', 0));
    await dropConnectionForTest();
    await putChunk(chunk('l1', 1));
    expect((await listPending('l1')).map((c) => c.idx)).toEqual([0, 1]);
  });

  it('filtra por aula e ordena por idx', async () => {
    await putChunk(chunk('l1', 1));
    await putChunk(chunk('l2', 0));
    await putChunk(chunk('l1', 0));
    expect((await listPending('l1')).map((c) => c.idx)).toEqual([0, 1]);
  });

  it('remove uma parte', async () => {
    await putChunk(chunk('l1', 0));
    await removeChunk('l1', 0);
    expect(await listPending()).toEqual([]);
  });
});
