-- Projetos novos do Supabase podem não liberar as tabelas criadas pelo SQL Editor para a API.
-- O RLS continua valendo: cada pessoa só enxerga as próprias aulas.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to service_role;
