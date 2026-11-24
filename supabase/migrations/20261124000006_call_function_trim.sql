-- Segredos colados no Vault podem vir com espaço ou quebra de linha no fim; isso quebrava a URL.
-- pg_net desiste em 5 s por padrão; transcrever um bloco leva mais.
create or replace function public.call_function(fn text, body jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := btrim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url'), E' \t\r\n/') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', btrim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'), E' \t\r\n')
    ),
    body := body,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function public.call_function(text, jsonb) from public, anon, authenticated;
