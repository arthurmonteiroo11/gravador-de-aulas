-- Lembrete diário de revisão (notificação no iPhone com o app na Tela de Início).

-- Aparelhos que pediram o lembrete. Cada pessoa só vê e mexe nos próprios.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  origin text not null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "dono dos avisos" on public.push_subscriptions;
create policy "dono dos avisos" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- Chaves do servidor de avisos (VAPID). Criadas sozinhas pela função na primeira vez.
-- Sem acesso pelo app: só a função, com a chave de serviço, lê esta tabela.
create table if not exists public.push_config (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
grant all on public.push_config to service_role;

-- Todo dia às 8h de Brasília (11:00 UTC): avisa quem tem flashcards para hoje.
select cron.unschedule('lembrete-revisao') where exists (select 1 from cron.job where jobname = 'lembrete-revisao');
select cron.schedule('lembrete-revisao', '0 11 * * *', $$
  select public.call_function('process-lesson', '{"remind": true}'::jsonb);
$$);
