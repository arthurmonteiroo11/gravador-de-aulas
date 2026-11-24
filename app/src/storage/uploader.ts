import { supabase } from '../lib/supabase';
import { listPending, removeChunk } from './localQueue';
import { errorText, recordProblem } from '../lib/diagnostics';

type Client = Pick<typeof supabase, 'storage' | 'from'>;

const DEFAULT_MIME = 'audio/mp4';

export const chunkPath = (userId: string, lessonId: string, idx: number, mime: string) =>
  `${userId}/${lessonId}/${idx}.${mime.startsWith('audio/mp4') ? 'm4a' : 'webm'}`;

/** Sobe as partes guardadas no aparelho. Só tira da fila depois do arquivo e da linha gravados. */
export async function uploadPending(userId: string, client: Client = supabase): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const chunk of await listPending()) {
    const mime = chunk.blob.type || DEFAULT_MIME;
    const path = chunkPath(userId, chunk.lessonId, chunk.idx, mime);
    try {
      const up = await client.storage.from('audio').upload(path, chunk.blob, { upsert: true, contentType: mime });
      if (up.error) throw up.error;
      const row = await client.from('audio_chunks').upsert({
        lesson_id: chunk.lessonId, idx: chunk.idx, start_s: chunk.startS, duration_s: chunk.durationS, path, mime_type: mime,
      });
      if (row.error) throw row.error;
      await removeChunk(chunk.lessonId, chunk.idx);
      uploaded++;
    } catch (err) {
      failed++;
      recordProblem('upload', await errorText(err));
    }
  }
  if (uploaded > 0 && failed === 0) recordProblem('upload', null);
  return { uploaded, failed };
}

/** Envia ao abrir o app, a cada 15 s e quando a internet volta. */
export function startUploadLoop(userId: string, onResult?: (r: { uploaded: number; failed: number }) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      onResult?.(await uploadPending(userId));
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 15_000);
  window.addEventListener('online', tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', tick);
  };
}
