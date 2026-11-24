-- Anotações por aula, edição dos textos e resumos que juntam várias aulas.

alter table public.lessons add column if not exists notes text not null default '';

-- O dono pode corrigir a transcrição, o resumo e a reescrita: só o texto, nada mais da linha.
revoke update on public.transcript_segments, public.lesson_outputs from authenticated;
grant update (text) on public.transcript_segments to authenticated;
grant update (content_md) on public.lesson_outputs to authenticated;
drop policy if exists "dono edita transcricao" on public.transcript_segments;
create policy "dono edita transcricao" on public.transcript_segments
  for update using (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));

drop policy if exists "dono edita saidas" on public.lesson_outputs;
create policy "dono edita saidas" on public.lesson_outputs
  for update using (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));

-- Resumo combinado: um texto gerado a partir de várias aulas.
create table if not exists public.study_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  lesson_ids uuid[] not null,
  content_md text not null,
  model text,
  request_key text unique,
  created_at timestamptz not null default now()
);
alter table public.study_notes add column if not exists request_key text unique;
create index if not exists study_notes_user_idx on public.study_notes (user_id, created_at desc);
alter table public.study_notes enable row level security;
drop policy if exists "dono dos resumos" on public.study_notes;
create policy "dono dos resumos" on public.study_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.study_notes to authenticated;
grant all on public.study_notes to service_role;
