import type { AudioChunk, ModelSegment, Segment } from './types.ts';

export const BLOCK_SIZE = 10;

/** Agrupa as partes de 1 min em blocos de 10, em ordem. */
export function groupIntoBlocks(chunks: AudioChunk[], size = BLOCK_SIZE): AudioChunk[][] {
  const sorted = [...chunks].sort((a, b) => a.idx - b.idx);
  const blocks: AudioChunk[][] = [];
  for (let i = 0; i < sorted.length; i += size) blocks.push(sorted.slice(i, i + size));
  return blocks;
}

/** Converte tempos relativos a cada parte em tempos da aula inteira. */
export function toAbsoluteSegments(block: AudioChunk[], segs: ModelSegment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const chunk = block[s.part];
    const text = s.text?.trim();
    if (!chunk || !text) continue;
    const clamp = (t: number) => Math.min(Math.max(0, t), chunk.duration_s);
    out.push({ start_s: chunk.start_s + clamp(s.start), end_s: chunk.start_s + clamp(s.end), text, speaker: cleanSpeaker(s.speaker) });
  }
  return out.sort((a, b) => a.start_s - b.start_s);
}

/** Rótulo de quem fala, curto e sem sujeira; vazio vira null. */
export function cleanSpeaker(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  return s || null;
}

/** Só vale marcar quem fala quando há mais de uma pessoa: numa aula só do professor, economiza texto. */
export const manySpeakers = (segments: { speaker?: string | null }[]) =>
  new Set(segments.map((s) => s.speaker).filter(Boolean)).size > 1;

/** Tempo como no app: mm:ss, ou h:mm:ss a partir de 1 hora. */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

/** Texto corrido com marcação de tempo, usado para a reescrita. */
export function transcriptText(segments: Segment[]): string {
  const who = manySpeakers(segments);
  return segments.map((s) => `[${clock(s.start_s)}] ${who && s.speaker ? `${s.speaker}: ` : ''}${s.text}`).join('\n');
}
