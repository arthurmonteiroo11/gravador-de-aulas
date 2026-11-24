import { aacBytes, readAacTrack, trackSeconds, UnsupportedMediaError } from './mp4';
import { readMp3Frames } from './mp3';
import { readAdtsFrames } from './adts';
import { WindowedReader } from './reader';

/** Mesmo limite da gravação: uma aula de até 1h30. */
export const MAX_IMPORT_S = 90 * 60;
/** Cada parte vai ao Gemini em blocos de 10: com ~1,4 MB por parte, o bloco fica abaixo do limite de envio. */
export const MAX_CHUNK_BYTES = 1_400_000;
export const TARGET_CHUNK_S = 60;

export type ImportedChunk = { idx: number; startS: number; durationS: number; blob: Blob };
export type Prepared = {
  kind: 'aac' | 'mp3';
  durationS: number;
  chunkCount: number;
  /** Gera as partes uma a uma, para não segurar o arquivo inteiro na memória. */
  chunks: () => AsyncGenerator<ImportedChunk>;
};

export { UnsupportedMediaError };

type Unit = { offset: number; size: number; seconds: number };

/** Agrupa quadros em partes de até 60 s, menores se o áudio for pesado. */
export function planChunks(units: Unit[], targetS = TARGET_CHUNK_S, maxBytes = MAX_CHUNK_BYTES): Array<{ from: number; to: number; startS: number; durationS: number }> {
  const plan = [];
  let from = 0;
  let start = 0;
  let seconds = 0;
  let bytes = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (i > from && (seconds + u.seconds > targetS + 1e-6 || bytes + u.size > maxBytes)) {
      plan.push({ from, to: i, startS: start, durationS: seconds });
      from = i;
      start += seconds;
      seconds = 0;
      bytes = 0;
    }
    seconds += u.seconds;
    bytes += u.size;
  }
  if (units.length > from) plan.push({ from, to: units.length, startS: start, durationS: seconds });
  return plan;
}

const extension = (name: string) => name.toLowerCase().split('.').pop() ?? '';

/** Lê o arquivo escolhido e prepara as partes no formato que o resto do app já sabe enviar. */
export async function prepareImport(file: File): Promise<Prepared> {
  const ext = extension(file.name);
  const type = file.type.toLowerCase();

  if (ext === 'mp3' || type === 'audio/mpeg' || type === 'audio/mp3') {
    return fromFrames('mp3', 'audio/mpeg', file, await readMp3Frames(file));
  }
  if (ext === 'aac' || type === 'audio/aac') {
    return fromFrames('aac', 'audio/aac', file, await readAdtsFrames(file));
  }
  if (['m4a', 'mp4', 'mov', 'm4v', '3gp'].includes(ext) || /^(audio|video)\/(mp4|x-m4a|quicktime|m4a|3gpp)/.test(type)) {
    const track = await readAacTrack(file);
    const durationS = trackSeconds(track);
    checkLength(durationS);
    const units = track.samples.map((s) => ({ offset: s.offset, size: s.size + 7, seconds: s.duration / track.timescale }));
    const plan = planChunks(units);
    return {
      kind: 'aac',
      durationS,
      chunkCount: plan.length,
      chunks: async function* () {
        const reader = new WindowedReader(file);
        for (const [idx, p] of plan.entries()) {
          const bytes = await aacBytes(file, track, p.from, p.to, reader);
          yield { idx, startS: p.startS, durationS: p.durationS, blob: new Blob([bytes], { type: 'audio/aac' }) };
        }
      },
    };
  }
  throw new UnsupportedMediaError('Formato não suportado. Use um arquivo m4a, mp3, aac, mp4 ou mov.');
}

function checkLength(seconds: number) {
  if (seconds <= 0) throw new UnsupportedMediaError('Não achei áudio neste arquivo.');
  if (seconds > MAX_IMPORT_S + 30) {
    const total = Math.round(seconds / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    throw new UnsupportedMediaError(`O arquivo tem ${h ? `${h} h ${m} min` : `${m} min`}. O limite é 1h30 por aula: corte o arquivo e importe em partes.`);
  }
}

function fromFrames(kind: 'aac' | 'mp3', mime: string, file: Blob, frames: Unit[]): Prepared {
  const durationS = frames.reduce((t, f) => t + f.seconds, 0);
  if (!frames.length) throw new UnsupportedMediaError('Não achei áudio neste arquivo.');
  checkLength(durationS);
  const plan = planChunks(frames);
  return {
    kind,
    durationS,
    chunkCount: plan.length,
    chunks: async function* () {
      const reader = new WindowedReader(file);
      for (const [idx, p] of plan.entries()) {
        const parts = [];
        for (const f of frames.slice(p.from, p.to)) parts.push((await reader.read(f.offset, f.size)).slice());
        yield { idx, startS: p.startS, durationS: p.durationS, blob: new Blob(parts, { type: mime }) };
      }
    },
  };
}
