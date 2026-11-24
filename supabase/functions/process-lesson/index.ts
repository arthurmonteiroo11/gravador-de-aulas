import { createClient } from 'npm:@supabase/supabase-js@2';
import { processUntilDone, type StepDeps } from '../_shared/processStep.ts';
import { askAboutLessons, combineTexts, GEMINI_MODEL, GeminiTimeoutError, makeFlashcards, QuotaError, RateLimitError, rewriteAndSummarize, transcribeBlock } from '../_shared/gemini.ts';
import { flashcardsPrompt } from '../_shared/flashcards.ts';
import { combinePrompt, fallbackTitle, MAX_LESSONS, type CombineSource } from '../_shared/combine.ts';
import type { LessonRow } from '../_shared/types.ts';
import { contextNote } from '../_shared/context.ts';
import { generateVapidKeys, reminderMessage, sendPush, type VapidKeys } from '../_shared/webpush.ts';
import { askPrompt, cleanAnswer, MAX_ASK_LESSONS, MAX_QUESTION_CHARS, type AskLesson, type AskTurn } from '../_shared/ask.ts';

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
  // Matéria e termos da pasta: lidos uma vez por chamada. Sem a coluna (SQL antigo), segue sem contexto.
  let ctx: Promise<string> | null = null;
  const context = () => (ctx ??= (async () => {
    try {
      const lesson = must(await db.from('lessons').select('user_id, subject').eq('id', lessonId).single()) as { user_id: string; subject: string | null };
      if (!lesson.subject) return '';
      const { data } = await db.from('subjects').select('terms').eq('user_id', lesson.user_id).eq('name', lesson.subject).maybeSingle();
      return contextNote(lesson.subject, (data as { terms?: string } | null)?.terms ?? '');
    } catch (e) {
      console.warn('sem contexto da matéria:', e);
      return '';
    }
  })());
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
    // Em páginas: o banco entrega no máximo 1000 linhas, e uma aula de 1h30 pode passar disso.
    listSegments: async () => {
      const out = [];
      for (let from = 0; from < 50_000; from += 1000) {
        const page = must(await db.from('transcript_segments').select('start_s, end_s, text, speaker').eq('lesson_id', lessonId)
          .order('start_s').order('id').range(from, from + 999)) ?? [];
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    },
    saveOutputs: async ({ rewrite, summary }) =>
      void must(await db.from('lesson_outputs').upsert([
        { lesson_id: lessonId, kind: 'rewrite', content_md: rewrite, model: GEMINI_MODEL },
        { lesson_id: lessonId, kind: 'summary', content_md: summary, model: GEMINI_MODEL },
      ])),
    transcribe: async (parts) => transcribeBlock(parts, { context: await context() }),
    rewrite: async (t) => rewriteAndSummarize(t, { context: await context() }),
    model: GEMINI_MODEL,
    acquireLease: async () => Boolean(must(await db.rpc('try_lease', { p_lesson: lessonId, p_seconds: 150 }))),
    releaseLease: async () => void must(await db.rpc('release_lease', { p_lesson: lessonId })),
    now: () => new Date(),
  };
}

/** Junta várias aulas num resumo só. Roda com o login da pessoa: ela só alcança as próprias aulas. */
async function combine(req: Request, ids: unknown, requestKey: unknown): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'não autorizado' }, 403);
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_LESSONS || !ids.every((i) => typeof i === 'string')) {
    return json({ error: `Escolha de 2 a ${MAX_LESSONS} aulas.` }, 400);
  }
  const key = typeof requestKey === 'string' && requestKey.length <= 64 ? requestKey : null;
  const db = createClient(URL_, ANON_KEY, { global: { headers: { authorization: auth } } });

  // Mesmo pedido repetido (a conexão caiu antes da resposta): devolve o que já foi feito, sem gastar cota de novo.
  if (key) {
    const { data: done } = await db.from('study_notes').select('id').eq('request_key', key).maybeSingle();
    if (done) return json({ id: done.id });
  }

  const [lessons, outputs] = await Promise.all([
    db.from('lessons').select('id, title, subject, recorded_at').in('id', ids),
    db.from('lesson_outputs').select('lesson_id, kind, content_md').in('lesson_id', ids),
  ]);
  if (lessons.error || outputs.error) throw lessons.error ?? outputs.error;
  if ((lessons.data ?? []).length !== ids.length) return json({ error: 'Aula não encontrada.' }, 404);

  const output = (id: string, kind: string) => outputs.data?.find((o) => o.lesson_id === id && o.kind === kind)?.content_md;
  const sources: Array<CombineSource & { id: string }> = [];
  for (const l of lessons.data!) {
    const text = output(l.id, 'rewrite') ?? output(l.id, 'summary') ?? (await transcriptOf(db, l.id));
    if (!text.trim()) return json({ error: `A aula "${l.title}" ainda não tem texto.` }, 409);
    sources.push({ ...l, text });
  }

  const result = await combineTexts(combinePrompt(sources));
  const ordered = [...sources].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const { data, error } = await db
    .from('study_notes')
    .insert({
      title: result.title || fallbackTitle(sources),
      lesson_ids: ordered.map((s) => s.id),
      content_md: result.content,
      model: GEMINI_MODEL,
      request_key: key,
    })
    .select('id')
    .single();
  if (error) throw error;
  return json({ id: data.id });
}

/** Transcrição inteira de uma aula, em páginas: o banco entrega no máximo 1000 linhas por vez. */
type Db = ReturnType<typeof createClient<any>>;

async function segmentsOf(db: Db, lessonId: string): Promise<{ start_s: number; text: string }[]> {
  const page = 1000;
  const out: { start_s: number; text: string }[] = [];
  for (let from = 0; from < 20_000; from += page) {
    const { data, error } = await db
      .from('transcript_segments')
      .select('start_s, text')
      .eq('lesson_id', lessonId)
      .order('start_s')
      .order('id')
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as { start_s: number; text: string }[]));
    if ((data ?? []).length < page) break;
  }
  return out;
}

async function transcriptOf(db: Db, lessonId: string): Promise<string> {
  return (await segmentsOf(db, lessonId)).map((s) => s.text).join(' ');
}

/** Pergunta sobre uma aula ou uma pasta. Roda com o login da pessoa e responde só com base nas transcrições. */
async function ask(req: Request, ids: unknown, question: unknown, history: unknown): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'não autorizado' }, 403);
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ASK_LESSONS || !ids.every((i) => typeof i === 'string')) {
    return json({ error: `Escolha de 1 a ${MAX_ASK_LESSONS} aulas.` }, 400);
  }
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q || q.length > MAX_QUESTION_CHARS) return json({ error: `Escreva uma pergunta de até ${MAX_QUESTION_CHARS} letras.` }, 400);
  const turns: AskTurn[] = (Array.isArray(history) ? history : [])
    .filter((t) => typeof t?.q === 'string' && typeof t?.a === 'string')
    .map((t) => ({ q: t.q, a: t.a }));
  const db = createClient(URL_, ANON_KEY, { global: { headers: { authorization: auth } } });

  const { data: rows, error } = await db.from('lessons').select('id, title, recorded_at').in('id', ids);
  if (error) throw error;
  if ((rows ?? []).length !== ids.length) return json({ error: 'Aula não encontrada.' }, 404);
  const ordered = [...rows!].sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const lessons: AskLesson[] = [];
  for (const l of ordered) lessons.push({ ...(l as Omit<AskLesson, 'segments'>), segments: await segmentsOf(db, l.id) });
  if (!lessons.some((l) => l.segments.length)) return json({ error: 'Estas aulas ainda não têm transcrição.' }, 409);

  const answer = cleanAnswer(await askAboutLessons(askPrompt(lessons, q, turns)), lessons);
  if (!answer.answer) return json({ error: 'O Gemini não respondeu. Tente perguntar de outro jeito.' }, 502);
  return json(answer);
}

/** Cria os flashcards de uma aula. Se já existirem, devolve os de antes, a menos que peça para refazer. */
async function flashcards(req: Request, lessonId: unknown, replace: boolean): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'não autorizado' }, 403);
  if (typeof lessonId !== 'string') return json({ error: 'Aula inválida.' }, 400);
  const db = createClient(URL_, ANON_KEY, { global: { headers: { authorization: auth } } });

  const existing = await db.from('flashcards').select('id', { count: 'exact', head: true }).eq('lesson_id', lessonId);
  if (existing.error) throw existing.error;
  if ((existing.count ?? 0) > 0 && !replace) return json({ count: existing.count });

  const [lesson, outputs] = await Promise.all([
    db.from('lessons').select('id, title, notes').eq('id', lessonId).maybeSingle(),
    db.from('lesson_outputs').select('kind, content_md').eq('lesson_id', lessonId),
  ]);
  if (lesson.error || outputs.error) throw lesson.error ?? outputs.error;
  if (!lesson.data) return json({ error: 'Aula não encontrada.' }, 404);
  const out = (kind: string) => outputs.data?.find((o) => o.kind === kind)?.content_md;
  const base = out('rewrite') ?? out('summary') ?? (await transcriptOf(db, lessonId));
  if (!base.trim()) return json({ error: 'A aula ainda não tem texto.' }, 409);
  const notes = (lesson.data.notes ?? '').trim();
  const text = notes ? `${base}\n\n## Anotações do aluno (dê prioridade ao que ele marcou)\n\n${notes}` : base;

  const cards = await makeFlashcards(flashcardsPrompt(lesson.data.title, text));
  // Guarda quais eram os antigos e só apaga depois que os novos entraram: uma falha não deixa a aula sem cartões.
  const old = replace ? await db.from('flashcards').select('id').eq('lesson_id', lessonId) : { data: [], error: null };
  if (old.error) throw old.error;
  const ins = await db.from('flashcards').insert(cards.map((c) => ({ ...c, lesson_id: lessonId })));
  if (ins.error) throw ins.error;
  const oldIds = (old.data ?? []).map((r) => r.id as string);
  if (oldIds.length) {
    const del = await db.from('flashcards').delete().in('id', oldIds);
    if (del.error) throw del.error;
  }
  return json({ count: cards.length });
}

/** Chaves do servidor de avisos: lidas do banco; na primeira vez, criadas e guardadas. */
async function vapidKeys(): Promise<VapidKeys> {
  const db = createClient(URL_, SERVICE_KEY);
  const read = async () => (await db.from('push_config').select('public_key, private_jwk').eq('id', 1).maybeSingle()).data;
  let row = await read();
  if (!row) {
    const k = await generateVapidKeys();
    // Duas chamadas ao mesmo tempo: só a primeira grava; as duas usam a que ficou.
    await db.from('push_config').upsert({ id: 1, public_key: k.publicKey, private_jwk: k.privateJwk }, { onConflict: 'id', ignoreDuplicates: true });
    row = await read();
  }
  if (!row) throw new Error('Não deu para criar as chaves dos avisos. Rode o SQL do lembrete.');
  return { publicKey: row.public_key, privateJwk: row.private_jwk };
}

type Subscription = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string; origin: string };

/** Manda o aviso para cada aparelho da lista; inscrição que não existe mais é apagada. */
async function notify(subs: Subscription[], message: (userId: string) => Promise<unknown | null>): Promise<{ sent: number; removed: number; failed: number }> {
  const db = createClient(URL_, SERVICE_KEY);
  const keys = await vapidKeys();
  const out = { sent: 0, removed: 0, failed: 0 };
  for (const sub of subs) {
    const msg = await message(sub.user_id);
    if (!msg) continue;
    try {
      const r = await sendPush(sub, msg, keys, sub.origin);
      if (r.gone) {
        await db.from('push_subscriptions').delete().eq('id', sub.id);
        out.removed++;
      } else if (r.ok) {
        await db.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).eq('id', sub.id);
        out.sent++;
      } else {
        console.warn(`aviso recusado (${r.status}) para ${new URL(sub.endpoint).host}`);
        out.failed++;
      }
    } catch (e) {
      console.warn('aviso falhou:', e);
      out.failed++;
    }
  }
  return out;
}

/** Agendador, todo dia de manhã: avisa só quem tem cartões vencidos. */
async function remindAll(): Promise<Response> {
  const db = createClient(URL_, SERVICE_KEY);
  const { data, error } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, origin');
  if (error) throw error;
  const due = new Map<string, number>();
  const now = new Date().toISOString();
  const result = await notify((data ?? []) as Subscription[], async (userId) => {
    if (!due.has(userId)) {
      const { count } = await db.from('flashcards').select('id', { count: 'exact', head: true }).eq('user_id', userId).lte('due_at', now);
      due.set(userId, count ?? 0);
    }
    const n = due.get(userId)!;
    return n > 0 ? reminderMessage(n) : null;
  });
  return json(result);
}

/** Botão "Enviar teste": só para os aparelhos de quem pediu. */
async function testPush(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'não autorizado' }, 403);
  const asUser = createClient(URL_, ANON_KEY, { global: { headers: { authorization: auth } } });
  const { data, error } = await asUser.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, origin');
  if (error) throw error;
  if (!data?.length) return json({ error: 'Este aparelho ainda não ativou o lembrete.' }, 404);
  const r = await notify(data as Subscription[], () => Promise.resolve({ title: 'Lembrete ativado', body: 'É assim que o aviso de revisão vai aparecer.', url: '/' }));
  if (!r.sent) return json({ error: 'O aviso não saiu. Desative e ative o lembrete de novo.' }, 502);
  return json(r);
}

/** Frase curta para a tela: o detalhe técnico fica no log da função. */
function aiErrorText(e: unknown, action: string): string {
  if (e instanceof QuotaError) return e.message;
  if (e instanceof GeminiTimeoutError) return `O Gemini demorou demais para responder. Tente ${action} de novo${action === 'juntar as aulas' ? ', com menos aulas de uma vez' : ''}.`;
  // Mostra o motivo que o Google deu: ajuda a saber se é limite por minuto ou sobrecarga.
  if (e instanceof RateLimitError) {
    const what = e.status === 503 ? 'está sobrecarregado' : 'recusou o pedido';
    return `O Gemini ${what} agora, também nos modelos reserva (erro ${e.status || '?'}${e.reason ? `: ${e.reason}` : ''}). Tente de novo em alguns minutos.`;
  }
  return `Não deu para ${action}: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);
  const body = await req.json().catch(() => ({}));
  if (body?.flashcards !== undefined) {
    try {
      return await flashcards(req, body.flashcards, body.replace === true);
    } catch (e) {
      console.error(e);
      return json({ error: aiErrorText(e, 'criar os flashcards') }, 500);
    }
  }
  if (body?.pushKey === true) {
    if (!req.headers.get('authorization')) return json({ error: 'não autorizado' }, 403);
    try {
      return json({ publicKey: (await vapidKeys()).publicKey });
    } catch (e) {
      console.error(e);
      return json({ error: 'Os avisos ainda não estão prontos no servidor. Rode o SQL do lembrete.' }, 500);
    }
  }
  if (body?.remind === true) {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'não autorizado' }, 403);
    try {
      return await remindAll();
    } catch (e) {
      console.error(e);
      return json({ error: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
    }
  }
  if (body?.testPush === true) {
    try {
      return await testPush(req);
    } catch (e) {
      console.error(e);
      return json({ error: 'Não deu para enviar o teste. Verifique a internet.' }, 500);
    }
  }
  if (body?.ask !== undefined) {
    try {
      return await ask(req, body.ask, body.question, body.history);
    } catch (e) {
      console.error(e);
      return json({ error: aiErrorText(e, 'responder') }, 500);
    }
  }
  if (body?.combine !== undefined) {
    try {
      return await combine(req, body.combine, body.requestKey);
    } catch (e) {
      console.error(e);
      return json({ error: aiErrorText(e, 'juntar as aulas') }, 500);
    }
  }
  const { lessonId } = body ?? {};
  if (typeof lessonId !== 'string') return json({ error: 'lessonId obrigatório' }, 400);
  if (!(await authorized(req, lessonId))) return json({ error: 'não autorizado' }, 403);
  try {
    return json(await processUntilDone(lessonId, depsFor(lessonId)));
  } catch (e) {
    console.error(e);
    return json({ error: `falha ao processar: ${String((e as Error)?.message ?? e).slice(0, 300)}` }, 500);
  }
});
