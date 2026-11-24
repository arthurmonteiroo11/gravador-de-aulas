import { WindowedReader } from './reader';

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Quadros de um arquivo .aac (ADTS): cada um já vem com o próprio cabeçalho. */
export async function readAdtsFrames(file: Blob): Promise<Array<{ offset: number; size: number; seconds: number }>> {
  const r = new WindowedReader(file);
  const frames = [];
  let o = 0;
  while (o + 7 <= file.size) {
    const h = await r.read(o, 7);
    const size = ((h[3] & 0x3) << 11) | (h[4] << 3) | (h[5] >> 5);
    const rate = SAMPLE_RATES[(h[2] >> 2) & 0xf];
    if (h[0] !== 0xff || (h[1] & 0xf6) !== 0xf0 || size < 7 || !rate || o + size > file.size) {
      o++;
      continue;
    }
    frames.push({ offset: o, size, seconds: (((h[6] & 0x3) + 1) * 1024) / rate });
    o += size;
  }
  return frames;
}
