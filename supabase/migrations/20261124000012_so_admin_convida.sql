-- Só quem tem conta criada no painel (sem convite) pode convidar. Quem entrou por convite não convida.
alter table public.members add column if not exists can_invite boolean not null default false;
update public.members set can_invite = true where invited_by is null;

create or replace function public.can_invite() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.members where user_id = auth.uid() and can_invite) $$;
revoke all on function public.can_invite() from public, anon;
grant execute on function public.can_invite() to authenticated, service_role;

drop policy if exists "membro convida" on public.invites;
create policy "membro convida" on public.invites for insert
  with check (created_by = auth.uid() and public.can_invite() and used_at is null and used_by is null
              and expires_at <= now() + interval '8 days');

-- Convites ainda abertos de quem não pode convidar deixam de valer.
delete from public.invites i
  where i.used_at is null and not exists (select 1 from public.members m where m.user_id = i.created_by and m.can_invite);
