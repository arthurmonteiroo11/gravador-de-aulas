import { fourcc, u16, u32, u64, WindowedReader } from './reader';

/**
 * Leitor mínimo de MP4/M4A/MOV só para a faixa de áudio AAC.
 * Tira os quadros de áudio como estão (sem decodificar) e os embrulha em ADTS,
 * o formato .aac que o Gemini e o Safari aceitam. Serve para importar vídeos e
 * áudios do iPhone e para exportar as partes gravadas como um arquivo só.
 */

export type Sample = { offset: number; size: number; dts: number; duration: number };
export type AacTrack = {
  timescale: number;
  sampleRate: number;
  channels: number;
  /** Cabeçalho de 7 bytes, sem o tamanho do quadro: ver adtsHeader. */
  profile: number;
  sfIndex: number;
  channelConfig: number;
  samples: Sample[];
};

export class UnsupportedMediaError extends Error {}

type Box = { type: string; start: number; size: number; header: number };

/** Caixas dentro de um trecho já carregado. */
function boxesIn(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      size = u64(b, o + 8);
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header || o + size > to) break;
    out.push({ type, start: o, size, header });
    o += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string, skip = 0) =>
  boxesIn(b, parent.start + parent.header + skip, parent.start + parent.size).find((x) => x.type === type);

const path = (b: Uint8Array, parent: Box, ...types: string[]) => {
  let cur: Box | undefined = parent;
  for (const t of types) cur = cur && child(b, cur, t);
  return cur;
};

/** Caixas do nível de cima do arquivo, lendo só os cabeçalhos. */
async function topLevel(r: WindowedReader): Promise<Box[]> {
  const out: Box[] = [];
  let o = 0;
  while (o + 8 <= r.size) {
    const h = await r.read(o, Math.min(16, r.size - o));
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    let header = 8;
    if (size === 1) {
      size = u64(h, 8);
      header = 16;
    } else if (size === 0) size = r.size - o;
    if (size < header) break;
    out.push({ type, start: o, size: Math.min(size, r.size - o), header });
    o += size;
  }
  return out;
}

/** Tamanho variável dos descritores do esds. */
function descriptor(b: Uint8Array, o: number): { tag: number; len: number; body: number } {
  const tag = b[o++];
  let len = 0;
  for (let i = 0; i < 4; i++) {
    const c = b[o++];
    len = (len << 7) | (c & 0x7f);
    if (!(c & 0x80)) break;
  }
  return { tag, len, body: o };
}

/** Procura uma caixa pelo tipo em qualquer profundidade de um trecho (o esds pode estar dentro de 'wave' no MOV). */
function findDeep(b: Uint8Array, from: number, to: number, type: string): Box | undefined {
  for (let o = from; o + 8 <= to; o++) {
    if (fourcc(b, o + 4) === type) {
      const size = u32(b, o);
      if (size >= 8 && o + size <= to) return { type, start: o, size, header: 8 };
    }
  }
  return undefined;
}

type Config = { profile: number; sfIndex: number; channelConfig: number };

/** Lê o AudioSpecificConfig do esds. */
function aacConfig(b: Uint8Array, esds: Box): Config {
  let o = esds.start + esds.header + 4;
  const es = descriptor(b, o);
  if (es.tag !== 0x03) throw new UnsupportedMediaError('Áudio sem descrição de formato');
  o = es.body + 2;
  const flags = b[o++];
  if (flags & 0x80) o += 2;
  if (flags & 0x40) o += 1 + b[o];
  if (flags & 0x20) o += 2;
  const dc = descriptor(b, o);
  if (dc.tag !== 0x04) throw new UnsupportedMediaError('Áudio sem descrição de formato');
  const oti = b[dc.body];
  if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) {
    throw new UnsupportedMediaError('O áudio deste arquivo não é AAC. Converta para m4a ou mp3 e tente de novo.');
  }
  const ds = descriptor(b, dc.body + 13);
  if (ds.tag !== 0x05 || ds.len < 2) throw new UnsupportedMediaError('Áudio sem configuração AAC');
  const asc = (b[ds.body] << 8) | b[ds.body + 1];
  let aot = asc >> 11;
  const sfIndex = (asc >> 7) & 0x0f;
  const channelConfig = (asc >> 3) & 0x0f;
  // HE-AAC (5, 29): o ADTS leva o perfil base (LC) e o decodificador acha o resto sozinho.
  if (aot === 5 || aot === 29) aot = 2;
  if (aot < 1 || aot > 4 || sfIndex > 12) throw new UnsupportedMediaError('Tipo de AAC não suportado');
  return { profile: aot - 1, sfIndex, channelConfig };
}

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Amostras de uma faixa sem fragmentos (tabelas stts, stsz, stsc, stco). */
function tableSamples(b: Uint8Array, stbl: Box): Sample[] {
  const stts = child(b, stbl, 'stts');
  const stsz = child(b, stbl, 'stsz');
  const stsc = child(b, stbl, 'stsc');
  const stco = child(b, stbl, 'stco') ?? child(b, stbl, 'co64');
  if (!stts || !stsz || !stsc || !stco) return [];

  let o = stsz.start + stsz.header + 4;
  const fixed = u32(b, o);
  const count = u32(b, o + 4);
  const sizes = Array.from({ length: count }, (_, i) => (fixed ? fixed : u32(b, o + 8 + i * 4)));

  o = stts.start + stts.header + 4;
  const durations: number[] = [];
  for (let i = 0, n = u32(b, o); i < n; i++) {
    const c = u32(b, o + 4 + i * 8);
    const d = u32(b, o + 8 + i * 8);
    for (let k = 0; k < c && durations.length < count; k++) durations.push(d);
  }

  o = stco.start + stco.header + 4;
  const wide = stco.type === 'co64';
  const offsets = Array.from({ length: u32(b, o) }, (_, i) => (wide ? u64(b, o + 4 + i * 8) : u32(b, o + 4 + i * 4)));

  o = stsc.start + stsc.header + 4;
  const runs = Array.from({ length: u32(b, o) }, (_, i) => ({ first: u32(b, o + 4 + i * 12) - 1, per: u32(b, o + 8 + i * 12) }));

  const samples: Sample[] = [];
  let s = 0;
  let dts = 0;
  for (let c = 0; c < offsets.length && s < count; c++) {
    let run = runs[0];
    for (const r of runs) if (r.first <= c) run = r;
    let off = offsets[c];
    for (let k = 0; k < run.per && s < count; k++, s++) {
      const duration = durations[s] ?? durations[durations.length - 1] ?? 1024;
      samples.push({ offset: off, size: sizes[s], dts, duration });
      off += sizes[s];
      dts += duration;
    }
  }
  return samples;
}

/** Amostras dos fragmentos (moof/traf/trun), como as gravações do iPhone. */
function fragmentSamples(b: Uint8Array, moof: Box, moofStart: number, trackId: number, defaults: { duration: number; size: number }, startDts: number): Sample[] {
  const out: Sample[] = [];
  for (const traf of boxesIn(b, moof.start + moof.header, moof.start + moof.size).filter((x) => x.type === 'traf')) {
    const tfhd = child(b, traf, 'tfhd');
    if (!tfhd) continue;
    let o = tfhd.start + tfhd.header;
    const flags = u32(b, o) & 0xffffff;
    if (u32(b, o + 4) !== trackId) continue;
    o += 8;
    let base = moofStart;
    if (flags & 0x1) {
      base = u64(b, o);
      o += 8;
    }
    if (flags & 0x2) o += 4;
    let defDuration = defaults.duration;
    let defSize = defaults.size;
    if (flags & 0x8) {
      defDuration = u32(b, o);
      o += 4;
    }
    if (flags & 0x10) defSize = u32(b, o);

    const tfdt = child(b, traf, 'tfdt');
    let dts = startDts;
    if (tfdt) {
      const v = b[tfdt.start + tfdt.header];
      dts = v === 1 ? u64(b, tfdt.start + tfdt.header + 4) : u32(b, tfdt.start + tfdt.header + 4);
    }

    for (const trun of boxesIn(b, traf.start + traf.header, traf.start + traf.size).filter((x) => x.type === 'trun')) {
      let p = trun.start + trun.header;
      const tf = u32(b, p) & 0xffffff;
      const n = u32(b, p + 4);
      p += 8;
      let dataOffset = base;
      if (tf & 0x1) {
        dataOffset = base + (u32(b, p) | 0);
        p += 4;
      }
      if (tf & 0x4) p += 4;
      let off = dataOffset;
      for (let i = 0; i < n; i++) {
        let duration = defDuration;
        let size = defSize;
        if (tf & 0x100) { duration = u32(b, p); p += 4; }
        if (tf & 0x200) { size = u32(b, p); p += 4; }
        if (tf & 0x400) p += 4;
        if (tf & 0x800) p += 4;
        out.push({ offset: off, size, dts, duration });
        off += size;
        dts += duration;
      }
    }
  }
  return out;
}

/** Abre o arquivo e acha a faixa de áudio AAC com todas as amostras. */
export async function readAacTrack(file: Blob): Promise<AacTrack> {
  const r = new WindowedReader(file);
  const top = await topLevel(r);
  const moovBox = top.find((x) => x.type === 'moov');
  if (!moovBox) throw new UnsupportedMediaError('Não reconheci este arquivo como áudio ou vídeo MP4.');
  const b = await r.read(moovBox.start, moovBox.size);
  const moov: Box = { ...moovBox, start: 0 };

  for (const trak of boxesIn(b, moov.header, moov.size).filter((x) => x.type === 'trak')) {
    const hdlr = path(b, trak, 'mdia', 'hdlr');
    if (!hdlr || fourcc(b, hdlr.start + hdlr.header + 8) !== 'soun') continue;
    const tkhd = child(b, trak, 'tkhd');
    const mdhd = path(b, trak, 'mdia', 'mdhd');
    const stbl = path(b, trak, 'mdia', 'minf', 'stbl');
    const stsd = stbl && child(b, stbl, 'stsd');
    if (!tkhd || !mdhd || !stbl || !stsd) continue;

    const tkv = b[tkhd.start + tkhd.header];
    const trackId = u32(b, tkhd.start + tkhd.header + (tkv === 1 ? 20 : 12));
    const mv = b[mdhd.start + mdhd.header];
    const timescale = u32(b, mdhd.start + mdhd.header + (mv === 1 ? 20 : 12));

    const entry = boxesIn(b, stsd.start + stsd.header + 8, stsd.start + stsd.size)[0];
    if (!entry) continue;
    if (entry.type !== 'mp4a') {
      throw new UnsupportedMediaError('O áudio deste arquivo não é AAC. Converta para m4a ou mp3 e tente de novo.');
    }
    const e = entry.start + entry.header;
    const channels = u16(b, e + 16);
    const esds = findDeep(b, e + 28, entry.start + entry.size, 'esds');
    if (!esds) throw new UnsupportedMediaError('Áudio sem configuração AAC');
    const config = aacConfig(b, esds);

    let samples = tableSamples(b, stbl);
    // Gravações em fragmentos: as amostras ficam nos moof, um depois do outro.
    const moofs = top.filter((x) => x.type === 'moof');
    if (moofs.length) {
      const mvex = path(b, moov, 'mvex');
      const trex = (mvex ? boxesIn(b, mvex.start + mvex.header, mvex.start + mvex.size) : [])
        .find((x) => x.type === 'trex' && u32(b, x.start + x.header + 4) === trackId);
      const defaults = trex
        ? { duration: u32(b, trex.start + trex.header + 12), size: u32(b, trex.start + trex.header + 16) }
        : { duration: 1024, size: 0 };
      let dts = samples.length ? samples[samples.length - 1].dts + samples[samples.length - 1].duration : 0;
      for (const m of moofs) {
        const mb = await r.read(m.start, m.size);
        const got = fragmentSamples(mb, { ...m, start: 0 }, m.start, trackId, defaults, dts);
        samples = samples.concat(got);
        if (got.length) dts = got[got.length - 1].dts + got[got.length - 1].duration;
      }
    }
    if (!samples.length) throw new UnsupportedMediaError('Não achei áudio neste arquivo.');
    return { timescale, sampleRate: SAMPLE_RATES[config.sfIndex], channels, ...config, samples };
  }
  throw new UnsupportedMediaError('Este arquivo não tem áudio.');
}

/** Cabeçalho ADTS de 7 bytes para um quadro AAC. */
export function adtsHeader(t: Pick<AacTrack, 'profile' | 'sfIndex' | 'channelConfig'>, payload: number): Uint8Array {
  const len = payload + 7;
  return new Uint8Array([
    0xff,
    0xf1,
    (t.profile << 6) | (t.sfIndex << 2) | ((t.channelConfig >> 2) & 0x1),
    ((t.channelConfig & 0x3) << 6) | ((len >> 11) & 0x3),
    (len >> 3) & 0xff,
    ((len & 0x7) << 5) | 0x1f,
    0xfc,
  ]);
}

/** Quadros [from, to) da faixa, como um .aac (ADTS) pronto para tocar ou enviar. */
export async function aacBytes(file: Blob, track: AacTrack, from = 0, to = track.samples.length, reader = new WindowedReader(file)): Promise<Uint8Array> {
  const picked = track.samples.slice(from, to);
  const out = new Uint8Array(picked.reduce((n, s) => n + s.size + 7, 0));
  let o = 0;
  for (const s of picked) {
    out.set(adtsHeader(track, s.size), o);
    out.set(await reader.read(s.offset, s.size), o + 7);
    o += s.size + 7;
  }
  return out;
}

export const trackSeconds = (t: AacTrack) =>
  t.samples.length ? (t.samples[t.samples.length - 1].dts + t.samples[t.samples.length - 1].duration - t.samples[0].dts) / t.timescale : 0;
