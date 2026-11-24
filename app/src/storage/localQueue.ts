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
    // O iOS derruba a conexão quando o app vai para o fundo; a próxima chamada abre outra.
    terminated() {
      dbPromise = null;
    },
  }));

/** Roda no banco; se a conexão caiu, abre de novo e tenta uma vez mais. */
async function withDb<T>(fn: (d: IDBPDatabase) => Promise<T>): Promise<T> {
  try {
    return await fn(await db());
  } catch {
    dbPromise = null;
    return fn(await db());
  }
}

/** Simula o iOS fechando a conexão sem avisar. Só para testes. */
export async function dropConnectionForTest(): Promise<void> {
  (await db()).close();
}

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
  await withDb((d) => d.put(STORE, stored));
}

export async function listPending(lessonId?: string): Promise<PendingChunk[]> {
  const all = (await withDb((d) => d.getAll(STORE))) as StoredChunk[];
  return all
    .filter((c) => !lessonId || c.lessonId === lessonId)
    .sort((a, b) => a.lessonId.localeCompare(b.lessonId) || a.idx - b.idx)
    .map(({ data, type, ...rest }) => ({ ...rest, blob: new Blob([data], { type }) }));
}

export async function removeChunk(lessonId: string, idx: number): Promise<void> {
  await withDb((d) => d.delete(STORE, [lessonId, idx]));
}

export async function closeQueue(): Promise<void> {
  if (!dbPromise) return;
  (await dbPromise).close();
  dbPromise = null;
}
