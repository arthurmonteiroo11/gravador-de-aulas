-- Termos da matéria: lista que a pessoa escreve por pasta e vai junto para o Gemini
-- na transcrição e na reescrita (nomes, fórmulas e palavras técnicas).
alter table public.subjects add column if not exists terms text not null default '';
alter table public.subjects drop constraint if exists subjects_terms_len;
alter table public.subjects add constraint subjects_terms_len check (length(terms) <= 2000);
