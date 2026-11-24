import { openDB, type IDBPDatabase } from 'idb';

export type PendingChunk = { lessonId: string; idx: number; blob: Blob; startS: number; durationS: number };

type StoredChunk = Omit<PendingChunk, 'blob'> & { data: ArrayBuffer; type: string };

const DB_NAME = 'gravador';
const STORE = 'chunks';
let dbPromise: Promise<IDBPDatabase> | null = null;

const db = () =>
  (dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: ['lessonId', 'idx'] });
    },
  }));

const readBlob = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

/** Guarda a parte no aparelho antes de qualquer envio. Bytes, não Blob, para funcionar em todo Safari. */
export async function putChunk(chunk: PendingChunk): Promise<void> {
  const { blob, ...rest } = chunk;
  const stored: StoredChunk = { ...rest, data: await readBlob(blob), type: blob.type };
  await (await db()).put(STORE, stored);
}

export async function listPending(lessonId?: string): Promise<PendingChunk[]> {
  const all = (await (await db()).getAll(STORE)) as StoredChunk[];
  return all
    .filter((c) => !lessonId || c.lessonId === lessonId)
    .sort((a, b) => a.lessonId.localeCompare(b.lessonId) || a.idx - b.idx)
    .map(({ data, type, ...rest }) => ({ ...rest, blob: new Blob([data], { type }) }));
}

export async function removeChunk(lessonId: string, idx: number): Promise<void> {
  await (await db()).delete(STORE, [lessonId, idx]);
}

export async function closeQueue(): Promise<void> {
  if (!dbPromise) return;
  (await dbPromise).close();
  dbPromise = null;
}
