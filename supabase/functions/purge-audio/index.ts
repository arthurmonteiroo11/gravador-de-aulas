import { createClient } from 'npm:@supabase/supabase-js@2';
import { purgeExpired } from '../_shared/purge.ts';
import { ownsPath } from '../_shared/invite.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const must = <T>(r: { data: T; error: unknown }) => {
  if (r.error) throw r.error;
  return r.data;
};

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('não autorizado', { status: 403 });
  }
  const result = await purgeExpired({
    listExpired: async () =>
      must(await db.from('lessons').select('id').lt('audio_expires_at', new Date().toISOString()).eq('audio_deleted', false)) ?? [],
    // Só apaga arquivos da pasta da própria aula, mesmo que uma linha aponte para outro lugar.
    listPaths: async (id) => {
      const owner = must(await db.from('lessons').select('user_id').eq('id', id).single()) as { user_id: string };
      return (must(await db.from('audio_chunks').select('path').eq('lesson_id', id)) ?? [])
        .map((r) => r.path as string)
        .filter((p) => ownsPath(p, owner.user_id, id));
    },
    removeFiles: async (paths) => void must(await db.storage.from('audio').remove(paths)),
    deleteChunkRows: async (id) => void must(await db.from('audio_chunks').delete().eq('lesson_id', id)),
    markDeleted: async (id) => void must(await db.from('lessons').update({ audio_deleted: true }).eq('id', id)),
  });
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
});
