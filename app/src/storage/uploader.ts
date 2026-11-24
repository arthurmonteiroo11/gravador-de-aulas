import { supabase } from '../lib/supabase';
import { listPending, removeChunk } from './localQueue';
import { errorText, recordProblem } from '../lib/diagnostics';

type Client = Pick<typeof supabase, 'storage' | 'from'>;

const DEFAULT_MIME = 'audio/mp4';
/** Uma parte de 60 s tem ~360 KB; 90 s cobre internet ruim. Sem limite, um envio travado prende a fila para sempre. */
const STEP_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} demorou demais`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export const chunkPath = (userId: string, lessonId: string, idx: number, mime: string) =>
  `${userId}/${lessonId}/${idx}.${mime.startsWith('audio/mp4') ? 'm4a' : 'webm'}`;

/** Sobe as partes guardadas no aparelho. Só tira da fila depois do arquivo e da linha gravados. */
export async function uploadPending(
  userId: string,
  client: Client = supabase,
  { timeoutMs = STEP_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  let pending;
  try {
    pending = await withTimeout(listPending(), timeoutMs, 'Ler as partes do aparelho');
  } catch (err) {
    recordProblem('upload', `Não consegui ler as partes salvas no aparelho: ${await errorText(err)}`);
    return { uploaded: 0, failed: 0 };
  }
  for (const chunk of pending) {
    // 'audio/mp4;codecs=...' vira 'audio/mp4': o Gemini e o Storage esperam o tipo puro.
    const mime = (chunk.blob.type || DEFAULT_MIME).split(';')[0].trim();
    const path = chunkPath(userId, chunk.lessonId, chunk.idx, mime);
    try {
      const up = await withTimeout(
        client.storage.from('audio').upload(path, chunk.blob, { upsert: true, contentType: mime }),
        timeoutMs,
        'Enviar o áudio',
      );
      if (up.error) throw up.error;
      const row = await withTimeout(client.from('audio_chunks').upsert({
        lesson_id: chunk.lessonId, idx: chunk.idx, start_s: chunk.startS, duration_s: chunk.durationS, path, mime_type: mime,
      }), timeoutMs, 'Registrar a parte');
      if (row.error) throw row.error;
      await withTimeout(removeChunk(chunk.lessonId, chunk.idx), timeoutMs, 'Limpar a parte do aparelho');
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
