// ZIP simples, sem compressão (o áudio já vem comprimido): escreve e lê só o que o próprio app gera.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

const utf8 = new TextEncoder();

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Monta o .zip como Blob: as partes ficam separadas na memória, sem copiar tudo num bloco só. */
export function makeZip(entries: ZipEntry[], when = new Date()): Blob {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  const { time, date } = dosTime(when);
  let offset = 0;
  for (const e of entries) {
    const name = utf8.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nomes em UTF-8
    lv.setUint16(8, 0, true); // sem compressão
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, e.data);
    central.push(cd);
    offset += local.length + e.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

export class ZipError extends Error {}

export type ZipFile = { names: string[]; read: (name: string) => Promise<Uint8Array> };

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** Lê o índice do .zip e abre cada arquivo só quando for pedido (bom para backups grandes com áudio). */
export async function openZip(file: Blob): Promise<ZipFile> {
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await bytesOf(file.slice(tailStart));
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Este arquivo não é um backup do app.');
  const tv = new DataView(tail.buffer, tail.byteOffset);
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  const cd = await bytesOf(file.slice(cdOffset, cdOffset + cdSize));
  const cv = new DataView(cd.buffer, cd.byteOffset);
  const dec = new TextDecoder();
  const index = new Map<string, { offset: number; size: number; method: number; crc: number }>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cv.getUint32(p, true) !== 0x02014b50) throw new ZipError('O backup está danificado.');
    const method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true);
    const size = cv.getUint32(p + 20, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const offset = cv.getUint32(p + 42, true);
    index.set(dec.decode(cd.subarray(p + 46, p + 46 + nameLen)), { offset, size, method, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...index.keys()],
    read: async (name) => {
      const e = index.get(name);
      if (!e) throw new ZipError(`O backup não tem ${name}.`);
      if (e.method !== 0) throw new ZipError('Este backup foi compactado de novo por outro programa. Use o arquivo original.');
      const head = new DataView((await bytesOf(file.slice(e.offset, e.offset + 30))).buffer);
      const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      const data = await bytesOf(file.slice(start, start + e.size));
      if (crc32(data) !== e.crc) throw new ZipError('O backup está danificado.');
      return data;
    },
  };
}
