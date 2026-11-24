import { WindowedReader } from './reader';

/** Um quadro MP3: posição no arquivo, tamanho e quantos segundos de áudio ele tem. */
export type Mp3Frame = { offset: number; size: number; seconds: number };

const BITRATES: Record<string, number[]> = {
  // MPEG-1 camada III e MPEG-2/2.5 camada III, em kbps.
  '1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Lê o cabeçalho de um quadro em b[o..o+4]. null se não for um quadro MP3 camada III válido. */
export function frameAt(b: Uint8Array, o: number): { size: number; seconds: number } | null {
  if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[o + 1] >> 3) & 0x3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[o + 1] >> 1) & 0x3; // 1 = camada III
  const bi = (b[o + 2] >> 4) & 0xf;
  const ri = (b[o + 2] >> 2) & 0x3;
  const pad = (b[o + 2] >> 1) & 0x1;
  if (version === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) return null;
  const kbps = BITRATES[version === 3 ? '1' : '2'][bi];
  const rate = RATES[version][ri];
  const perFrame = version === 3 ? 1152 : 576;
  const size = Math.floor(((perFrame / 8) * kbps * 1000) / rate) + pad;
  return { size, seconds: perFrame / rate };
}

/** Pula a etiqueta ID3v2 do começo (capa, título), se houver. */
function id3Size(h: Uint8Array): number {
  if (h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return 0;
  return 10 + ((h[6] & 0x7f) << 21) + ((h[7] & 0x7f) << 14) + ((h[8] & 0x7f) << 7) + (h[9] & 0x7f) + (h[5] & 0x10 ? 10 : 0);
}

/** Lista todos os quadros do arquivo sem decodificar o áudio. */
export async function readMp3Frames(file: Blob): Promise<Mp3Frame[]> {
  const r = new WindowedReader(file);
  let o = file.size >= 10 ? id3Size(await r.read(0, 10)) : 0;
  const frames: Mp3Frame[] = [];
  while (o + 4 <= file.size) {
    const h = await r.read(o, 4);
    const f = frameAt(h, 0);
    if (!f || o + f.size > file.size) {
      // Lixo entre quadros (ou etiqueta no fim): procura o próximo sinal de sincronia.
      o++;
      continue;
    }
    frames.push({ offset: o, size: f.size, seconds: f.seconds });
    o += f.size;
  }
  return frames;
}
