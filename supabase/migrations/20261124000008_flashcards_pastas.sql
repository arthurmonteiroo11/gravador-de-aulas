-- Flashcards gerados a partir das aulas, com revisão espaçada simples (caixas de Leitner).

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  front text not null,
  back text not null,
  box smallint not null default 1 check (box between 1 and 5),
  due_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists flashcards_due_idx on public.flashcards (user_id, due_at);
create index if not exists flashcards_lesson_idx on public.flashcards (lesson_id);

alter table public.flashcards enable row level security;
drop policy if exists "dono dos cartoes" on public.flashcards;
create policy "dono dos cartoes" on public.flashcards
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));

grant select, insert, update, delete on public.flashcards to authenticated;
grant all on public.flashcards to service_role;

-- Pastas de matérias: guardadas à parte para existir mesmo sem aulas dentro.
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.subjects enable row level security;
drop policy if exists "dono das materias" on public.subjects;
create policy "dono das materias" on public.subjects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.subjects to authenticated;
grant all on public.subjects to service_role;

-- Apagar uma aula também apaga o áudio dela no Storage (o dono pode remover os próprios arquivos).
drop policy if exists "audio: dono apaga" on storage.objects;
create policy "audio: dono apaga" on storage.objects for delete
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- Quando a aula entrou no app. Numa importação, recorded_at é a data do arquivo;
-- o servidor usa esta coluna para saber se o envio ainda está a caminho.
alter table public.lessons add column if not exists created_at timestamptz not null default now();
