import { supabase } from '../lib/supabase';
import type { Lesson } from '../lib/types';

/** Pastas de matérias: as criadas pela pessoa mais as que já aparecem nas aulas. */
export async function listFolders(): Promise<string[]> {
  const { data, error } = await supabase.from('subjects').select('name').order('name');
  // Sem a tabela (SQL ainda não rodado), as pastas saem só das aulas.
  if (error) return [];
  return (data ?? []).map((r) => r.name as string);
}

export type Subject = { name: string; terms: string };

/** Pastas com os termos de cada uma. Antes do SQL dos termos, vem sem termos. */
export async function listSubjects(): Promise<Subject[]> {
  const withTerms = await supabase.from('subjects').select('name, terms').order('name');
  if (!withTerms.error) return (withTerms.data ?? []) as Subject[];
  return (await listFolders()).map((name) => ({ name, terms: '' }));
}

export const MAX_TERMS_CHARS = 2000;

/** Quantos termos tem a lista (separados por vírgula, ponto e vírgula ou linha). */
export const termCount = (terms: string) => new Set(terms.split(/[,;\n]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)).size;

/** Guarda os termos da pasta; cria a pasta se ela só existia nas aulas. */
export async function saveTerms(name: string, terms: string): Promise<void> {
  const n = cleanName(name);
  if (!n) throw new Error('Pasta sem nome.');
  const { error } = await supabase.from('subjects').upsert({ name: n, terms: terms.slice(0, MAX_TERMS_CHARS) }, { onConflict: 'user_id,name' });
  if (error) throw new Error('Não salvou os termos. Verifique a internet.');
}

export function mergeFolders(saved: string[], lessons: Pick<Lesson, 'subject'>[]): string[] {
  const all = new Set([...saved, ...lessons.map((l) => l.subject?.trim()).filter((s): s is string => Boolean(s))]);
  return [...all].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 60);

export async function createFolder(name: string): Promise<void> {
  const n = cleanName(name);
  if (!n) throw new Error('Dê um nome para a pasta.');
  const { error } = await supabase.from('subjects').upsert({ name: n }, { onConflict: 'user_id,name', ignoreDuplicates: true });
  if (error) throw error;
}

/** Já existe outra pasta com esse nome (sem diferenciar maiúsculas)? */
export const folderTaken = (name: string, from: string, folders: string[]) => {
  const key = cleanName(name).toLocaleLowerCase('pt-BR');
  return folders.some((f) => f !== from && f.toLocaleLowerCase('pt-BR') === key);
};

/** Renomeia a pasta e leva junto todas as aulas dela. Nunca junta duas pastas sem a pessoa pedir. */
export async function renameFolder(from: string, to: string, folders: string[] = []): Promise<void> {
  const n = cleanName(to);
  if (!n) throw new Error('Dê um nome para a pasta.');
  if (n === from) return;
  if (folderTaken(n, from, folders)) throw new Error(`Já existe uma pasta "${n}". Escolha outro nome.`);
  await createFolder(n);
  const lessons = await supabase.from('lessons').update({ subject: n }).eq('subject', from);
  if (lessons.error) throw lessons.error;
  const { error } = await supabase.from('subjects').delete().eq('name', from);
  if (error) throw error;
}

/** Apaga a pasta. As aulas continuam, só ficam sem matéria. */
export async function deleteFolder(name: string): Promise<void> {
  const lessons = await supabase.from('lessons').update({ subject: null }).eq('subject', name);
  if (lessons.error) throw lessons.error;
  const { error } = await supabase.from('subjects').delete().eq('name', name);
  if (error) throw error;
}
