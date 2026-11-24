-- Jobs agendados. Precisam de dois segredos no Vault (Project Settings > Vault):
--   project_url  = https://SEU-PROJETO.supabase.co
--   cron_secret  = o mesmo valor do segredo CRON_SECRET das Edge Functions
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_function(fn text, body jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := body
  );
$$;
revoke all on function public.call_function(text, jsonb) from public, anon, authenticated;

-- A cada 5 min: avança aulas que ficaram enviando ou transcrevendo com o app fechado.
select cron.schedule('avancar-aulas', '*/5 * * * *', $$
  select public.call_function('process-lesson', jsonb_build_object('lessonId', l.id))
  from public.lessons l
  where l.status in ('uploading', 'processing');
$$);

-- Todo dia às 04:00 de Brasília (07:00 UTC): apaga áudio com mais de 30 dias.
select cron.schedule('apagar-audio-vencido', '0 7 * * *', $$
  select public.call_function('purge-audio', '{}'::jsonb);
$$);
