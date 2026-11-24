import { createClient } from 'npm:@supabase/supabase-js@2';
import { processUntilDone, type StepDeps } from '../_shared/processStep.ts';
import { GEMINI_MODEL, rewriteAndSummarize, transcribeBlock } from '../_shared/gemini.ts';
import type { LessonRow } from '../_shared/types.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

/** Confere se quem chamou é o dono da aula (ou o agendador, com o segredo). */
async function authorized(req: Request, lessonId: string): Promise<boolean> {
  if (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET) return true;
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const asUser = createClient(URL_, ANON_KEY, { global: { headers: { authorization: auth } } });
  const { data } = await asUser.from('lessons').select('id').eq('id', lessonId).maybeSingle();
  return Boolean(data);
}

function depsFor(lessonId: string): StepDeps {
  const db = createClient(URL_, SERVICE_KEY);
  const must = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    getLesson: async (id) => must(await db.from('lessons').select('*').eq('id', id).single()) as LessonRow,
    updateLesson: async (patch) => void must(await db.from('lessons').update(patch).eq('id', lessonId)),
    listChunks: async () => must(await db.from('audio_chunks').select('*').eq('lesson_id', lessonId).order('idx')) ?? [],
    download: async (path) => {
      const { data, error } = await db.storage.from('audio').download(path);
      if (error) throw error;
      return new Uint8Array(await data.arrayBuffer());
    },
    replaceSegments: async (blockIdx, segs) =>
      void must(await db.rpc('replace_block_segments', { p_lesson: lessonId, p_block: blockIdx, p_segments: segs })),
    listSegments: async () =>
      must(await db.from('transcript_segments').select('start_s, end_s, text, speaker').eq('lesson_id', lessonId).order('start_s')) ?? [],
    saveOutputs: async ({ rewrite, summary }) =>
      void must(await db.from('lesson_outputs').upsert([
        { lesson_id: lessonId, kind: 'rewrite', content_md: rewrite, model: GEMINI_MODEL },
        { lesson_id: lessonId, kind: 'summary', content_md: summary, model: GEMINI_MODEL },
      ])),
    transcribe: (parts) => transcribeBlock(parts),
    rewrite: (t) => rewriteAndSummarize(t),
    model: GEMINI_MODEL,
    acquireLease: async () => Boolean(must(await db.rpc('try_lease', { p_lesson: lessonId, p_seconds: 150 }))),
    releaseLease: async () => void must(await db.rpc('release_lease', { p_lesson: lessonId })),
    now: () => new Date(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);
  const { lessonId } = await req.json().catch(() => ({}));
  if (typeof lessonId !== 'string') return json({ error: 'lessonId obrigatório' }, 400);
  if (!(await authorized(req, lessonId))) return json({ error: 'não autorizado' }, 403);
  try {
    return json(await processUntilDone(lessonId, depsFor(lessonId)));
  } catch (e) {
    console.error(e);
    return json({ error: 'falha ao processar' }, 500);
  }
});
