// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planChunks, prepareImport, UnsupportedMediaError } from './importFile';
import { readAacTrack, trackSeconds } from './mp4';

// Lê os arquivos de exemplo pelo Node, sem depender dos tipos do Node no projeto do app.
type NodeFs = { readFileSync: (path: string) => Uint8Array };
const fs = (globalThis as unknown as { process: { getBuiltinModule: (m: string) => NodeFs } }).process.getBuiltinModule('fs');
const fixture = (name: string, type = '') => {
  const bytes = fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/src/, `${'.'}/src`));
  return new File([bytes], name, { type });
};

const collect = async (p: Awaited<ReturnType<typeof prepareImport>>) => {
  const out = [];
  for await (const c of p.chunks()) out.push(c);
  return out;
};

describe('planChunks', () => {
  it('divide em partes de até 60 s e respeita o tamanho máximo', () => {
    const units = Array.from({ length: 300 }, (_, i) => ({ offset: i * 100, size: 100, seconds: 0.5 }));
    const plan = planChunks(units, 60, 1e9);
    expect(plan.map((p) => p.durationS)).toEqual([60, 60, 30]);
    expect(plan[1].startS).toBe(60);
    expect(planChunks(units, 60, 5_000).every((p) => (p.to - p.from) * 100 <= 5_000)).toBe(true);
  });
});

describe('prepareImport', () => {
  it('m4a: tira o AAC em ADTS com a duração certa', async () => {
    const p = await prepareImport(fixture('tone.m4a', 'audio/x-m4a'));
    expect(p.kind).toBe('aac');
    expect(p.durationS).toBeGreaterThan(7.9);
    expect(p.durationS).toBeLessThan(8.2);
    const [chunk] = await collect(p);
    const head = new Uint8Array(await chunk.blob.arrayBuffer());
    expect(head[0]).toBe(0xff);
    expect(head[1] & 0xf0).toBe(0xf0);
    expect(chunk.blob.type).toBe('audio/aac');
  });

  it('vídeo mp4: pega só o áudio', async () => {
    const p = await prepareImport(fixture('clip.mp4', 'video/mp4'));
    expect(p.durationS).toBeGreaterThan(5.8);
    expect(p.durationS).toBeLessThan(6.2);
  });

  it('m4a em fragmentos (como a gravação do iPhone)', async () => {
    const t = await readAacTrack(fixture('frag.m4a'));
    expect(trackSeconds(t)).toBeGreaterThan(6.8);
    expect(trackSeconds(t)).toBeLessThan(7.2);
  });

  it('mp3: separa por quadros e pula a etiqueta ID3', async () => {
    const p = await prepareImport(fixture('tone.mp3', 'audio/mpeg'));
    expect(p.kind).toBe('mp3');
    expect(p.durationS).toBeGreaterThan(8.9);
    expect(p.durationS).toBeLessThan(9.2);
    const chunks = await collect(p);
    expect(chunks[0].blob.type).toBe('audio/mpeg');
    const head = new Uint8Array(await chunks[0].blob.arrayBuffer());
    expect(head[0]).toBe(0xff);
  });

  it('recusa formatos que não conhece', async () => {
    await expect(prepareImport(new File(['oi'], 'nota.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(UnsupportedMediaError);
  });
});
