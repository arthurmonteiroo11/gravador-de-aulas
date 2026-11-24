import { supabase } from '../lib/supabase';

// Quem fala na aula: o Gemini marca "Professor", "Aluno 1", "Falante 1"...; a pessoa pode trocar por nomes.

export type SpeakerNames = Record<string, string>;

/** Rótulos na ordem em que aparecem. */
export const speakerList = (segments: { speaker?: string | null }[]) => [...new Set(segments.map((s) => s.speaker).filter((s): s is string => Boolean(s)))];

/** Só vale mostrar quem fala quando há mais de uma pessoa. */
export const manySpeakers = (segments: { speaker?: string | null }[]) => speakerList(segments).length > 1;

export const speakerName = (label: string | null | undefined, names: SpeakerNames = {}) => (label ? names[label]?.trim() || label : null);

/** Marca o nome só quando a pessoa que fala muda, como num roteiro. */
export const speakerChanges = (segments: { speaker?: string | null }[]) =>
  segments.map((s, i) => Boolean(s.speaker) && s.speaker !== segments[i - 1]?.speaker);

export function cleanNames(names: SpeakerNames, labels: string[]): SpeakerNames {
  const out: SpeakerNames = {};
  for (const l of labels) {
    const n = (names[l] ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (n && n !== l) out[l] = n;
  }
  return out;
}

export async function saveSpeakerNames(lessonId: string, names: SpeakerNames): Promise<void> {
  const { error } = await supabase.from('lessons').update({ speaker_names: names }).eq('id', lessonId);
  if (error) throw new Error(/speaker_names/.test(error.message) ? 'Rode o SQL desta versão para guardar os nomes.' : 'Não deu para salvar os nomes. Verifique a internet.');
}
