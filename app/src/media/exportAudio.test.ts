// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fileName, joinAudio } from './exportAudio';

type NodeFs = { readFileSync: (path: string) => Uint8Array };
const fs = (globalThis as unknown as { process: { getBuiltinModule: (m: string) => NodeFs } }).process.getBuiltinModule('fs');
const bytes = (name: string) => fs.readFileSync(`./src/media/fixtures/${name}`);
const fetcher = (async (url: string) => new Response(bytes(url))) as unknown as typeof fetch;

describe('joinAudio', () => {
  it('emenda gravações m4a num .aac só', async () => {
    const r = await joinAudio([{ url: 'frag.m4a', mime: 'audio/mp4' }, { url: 'tone.m4a', mime: 'audio/mp4' }], fetcher);
    expect(r.ext).toBe('aac');
    // Dois arquivos de ~7 s e ~8 s, a 24 kbps: o resultado tem o áudio dos dois.
    expect(r.bytes.length).toBeGreaterThan(40_000);
    expect(r.bytes[0]).toBe(0xff);
  });

  it('emenda mp3 como está', async () => {
    const r = await joinAudio([{ url: 'tone.mp3', mime: 'audio/mpeg' }, { url: 'tone.mp3', mime: 'audio/mpeg' }], fetcher);
    expect(r.ext).toBe('mp3');
    expect(r.bytes.length).toBe(bytes('tone.mp3').length * 2);
  });
});

describe('fileName', () => {
  it('tira caracteres proibidos', () => {
    expect(fileName('Aula 1/2: "Limites"?', 'aac')).toBe('Aula 12 Limites.aac');
  });
});
