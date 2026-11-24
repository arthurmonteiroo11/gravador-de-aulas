-- Convites, membros, backup e reforços de segurança.

-- 1. Membros: só quem está aqui grava aulas, cria pastas e usa o Gemini.
-- Quem já tem conta hoje entra automaticamente.
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
insert into public.members (user_id) select id from auth.users on conflict do nothing;
alter table public.members enable row level security;
drop policy if exists "membro se ve" on public.members;
create policy "membro se ve" on public.members for select using (user_id = auth.uid());
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;
grant all on public.members to service_role;

create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.members where user_id = auth.uid()) $$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated, service_role;

-- Sem ser membro, uma conta criada por fora não consegue criar nada.
drop policy if exists "dono das aulas" on public.lessons;
create policy "dono das aulas" on public.lessons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "dono das materias" on public.subjects;
create policy "dono das materias" on public.subjects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "dono dos resumos" on public.study_notes;
create policy "dono dos resumos" on public.study_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "dono dos avisos" on public.push_subscriptions;
create policy "dono dos avisos" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

drop policy if exists "audio: dono envia" on storage.objects;
create policy "audio: dono envia" on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());

-- 2. Cada parte de áudio só pode apontar para um arquivo da própria pessoa, na pasta da própria aula.
-- Antes dava para registrar o caminho do arquivo de outra conta e o servidor o leria.
drop policy if exists "dono das partes" on public.audio_chunks;
create policy "dono das partes" on public.audio_chunks
  for all using (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()))
  with check (
    exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid())
    and split_part(path, '/', 1) = auth.uid()::text
    and split_part(path, '/', 2) = lesson_id::text
    and path not like '%..%'
  );

-- 3. Backup: devolver a transcrição e os textos de uma aula própria.
drop policy if exists "dono importa transcricao" on public.transcript_segments;
create policy "dono importa transcricao" on public.transcript_segments
  for insert with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));
drop policy if exists "dono importa saidas" on public.lesson_outputs;
create policy "dono importa saidas" on public.lesson_outputs
  for insert with check (exists (select 1 from public.lessons l where l.id = lesson_id and l.user_id = auth.uid()));
grant insert on public.transcript_segments, public.lesson_outputs to authenticated;

-- 4. Convites de uso único. Quem convida vê e cancela os próprios; quem usa é a função, com a chave de serviço.
create table if not exists public.invites (
  code text primary key check (code ~ '^[A-Z2-9]{10}$'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
alter table public.invites enable row level security;
drop policy if exists "quem convida ve" on public.invites;
create policy "quem convida ve" on public.invites for select using (created_by = auth.uid());
drop policy if exists "membro convida" on public.invites;
create policy "membro convida" on public.invites for insert
  with check (created_by = auth.uid() and public.is_member() and used_at is null and used_by is null
              and expires_at <= now() + interval '8 days');
drop policy if exists "quem convida cancela" on public.invites;
create policy "quem convida cancela" on public.invites for delete using (created_by = auth.uid() and used_at is null);
revoke all on public.invites from anon, authenticated;
grant select, insert, delete on public.invites to authenticated;
grant all on public.invites to service_role;

-- 5. Quem fala: o Gemini marca "Professor", "Aluno 1", "Falante 1"... e a pessoa pode dar nome a cada um, por aula.
alter table public.lessons add column if not exists speaker_names jsonb not null default '{}'::jsonb;
alter table public.lessons drop constraint if exists lessons_speaker_names_size;
alter table public.lessons add constraint lessons_speaker_names_size check (pg_column_size(speaker_names) <= 4000);
