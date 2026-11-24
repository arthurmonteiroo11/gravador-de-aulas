/**
 * Lê pedaços de um arquivo grande sem carregá-lo inteiro na memória:
 * guarda uma janela de alguns MB e só busca de novo quando sai dela.
 */
export class WindowedReader {
  private start = 0;
  private bytes = new Uint8Array(0);

  constructor(readonly blob: Blob, private readonly windowSize = 8 * 1024 * 1024) {}

  get size(): number {
    return this.blob.size;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset + length > this.blob.size) throw new RangeError('Leitura fora do arquivo');
    const inside = offset >= this.start && offset + length <= this.start + this.bytes.length;
    if (!inside) {
      const size = Math.max(length, this.windowSize);
      const end = Math.min(this.blob.size, offset + size);
      this.bytes = new Uint8Array(await this.blob.slice(offset, end).arrayBuffer());
      this.start = offset;
    }
    return this.bytes.subarray(offset - this.start, offset - this.start + length);
  }
}

export const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
export const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
export const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
