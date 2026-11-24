import { aacBytes, readAacTrack } from './mp4';

export type ExportPart = { url: string; mime: string };

/**
 * Junta as partes de uma aula num arquivo só, sem perder qualidade:
 * as gravações (m4a) viram AAC puro e são emendadas; mp3 é emendado como está.
 */
export async function joinAudio(parts: ExportPart[], fetcher: typeof fetch = fetch): Promise<{ bytes: Uint8Array; ext: 'aac' | 'mp3'; mime: string }> {
  const mp3 = parts.length > 0 && parts.every((p) => p.mime.startsWith('audio/mpeg'));
  const pieces: Uint8Array[] = [];
  for (const p of parts) {
    const res = await fetcher(p.url);
    if (!res.ok) throw new Error(`Não consegui baixar uma parte do áudio (${res.status}).`);
    const blob = await res.blob();
    if (p.mime.startsWith('audio/mp4')) pieces.push(await aacBytes(blob, await readAacTrack(blob)));
    else if (p.mime.startsWith('audio/aac') || mp3) pieces.push(new Uint8Array(await blob.arrayBuffer()));
    else throw new Error('Esta aula tem partes em um formato que não dá para juntar.');
  }
  const bytes = new Uint8Array(pieces.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of pieces) {
    bytes.set(x, o);
    o += x.length;
  }
  return mp3 ? { bytes, ext: 'mp3', mime: 'audio/mpeg' } : { bytes, ext: 'aac', mime: 'audio/aac' };
}

/** Nome de arquivo seguro a partir do título da aula. */
export const fileName = (title: string, ext: string) =>
  `${title.normalize('NFC').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'aula'}.${ext}`;

/** No iPhone abre a folha de compartilhar (salvar em Arquivos, mandar por WhatsApp…); no resto, baixa. */
export async function shareFile(file: File): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
