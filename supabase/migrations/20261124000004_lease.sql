-- Evita duas chamadas processando a mesma aula ao mesmo tempo (app + agendador).
alter table public.lessons add column lease_until timestamptz;

create or replace function public.try_lease(p_lesson uuid, p_seconds integer default 240)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with got as (
    update public.lessons
       set lease_until = now() + make_interval(secs => p_seconds)
     where id = p_lesson and (lease_until is null or lease_until < now())
    returning 1
  )
  select exists (select 1 from got);
$$;

create or replace function public.release_lease(p_lesson uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.lessons set lease_until = null where id = p_lesson;
$$;

-- Troca os trechos de um bloco numa só transação (sem duplicar se repetir).
create or replace function public.replace_block_segments(p_lesson uuid, p_block integer, p_segments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.transcript_segments where lesson_id = p_lesson and block_idx = p_block;
  insert into public.transcript_segments (lesson_id, block_idx, start_s, end_s, text, speaker)
  select p_lesson, p_block, (s->>'start_s')::real, (s->>'end_s')::real, s->>'text', s->>'speaker'
    from jsonb_array_elements(p_segments) s;
end;
$$;

revoke all on function public.try_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_lease(uuid) from public, anon, authenticated;
revoke all on function public.replace_block_segments(uuid, integer, jsonb) from public, anon, authenticated;
