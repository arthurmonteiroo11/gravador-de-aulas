-- Quantas partes o app gravou; o servidor só processa quando todas chegaram.
alter table public.lessons add column expected_chunks integer;
