-- Gravador de Aulas: tabelas, segurança por usuário e bucket de áudio.

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  subject text,
  recorded_at timestamptz not null default now(),
  duration_s integer not null default 0,
  status text not null default 'recording'
    check (status in ('recording','uploading','processing','ready','error')),
  processed_blocks integer not null default 0,
  total_blocks integer,
  block_failures integer not null default 0,
  error_message text,
  audio_expires_at timestamptz not null default (now() + interval '30 days'),
  audio_deleted boolean not null default false
);
create index lessons_user_recorded_idx on public.lessons (user_id, recorded_at desc);

create table public.audio_chunks (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  idx integer not null check (idx >= 0),
  start_s real not null,
  duration_s real not null,
  path text not null,
  mime_type text not null default 'audio/mp4',
  primary key (lesson_id, idx)
);

create table public.transcript_segments (
  id bigint generated always as identity primary key,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  block_idx integer not null,
  start_s real not null,
  end_s real not null,
  text text not null,
  speaker text  -- vazio na V1; reservado para separar vozes
);
create index transcript_segments_lesson_idx on public.transcript_segments (lesson_id, start_s);

create table public.lesson_outputs (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  kind text not null check (kind in ('rewrite','summary')),
  content_md text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (lesson_id, kind)
);

alter table public.lessons enable row level security;
alter table public.audio_chunks enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.lesson_outputs enable row level security;

create policy "dono das aulas" on public.lessons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "dono das partes" on public.audio_chunks
  for all using (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));

create policy "dono da transcricao" on public.transcript_segments
  for select using (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));

create policy "dono das saidas" on public.lesson_outputs
  for select using (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));

-- Bucket privado: caminho {user_id}/{lesson_id}/{idx}.m4a
insert into storage.buckets (id, name, public) values ('audio', 'audio', false)
  on conflict (id) do nothing;

create policy "audio: dono le" on storage.objects for select
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio: dono envia" on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "audio: dono atualiza" on storage.objects for update
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
