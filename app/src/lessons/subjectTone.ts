// Cores de divisória de caderno: cada matéria sempre ganha a mesma.
const TONES = ['#2f49d1', '#d9822b', '#2a9d6f', '#b14fc5', '#d6455d', '#2f8fb3', '#8a6d1f', '#5b6ad9'];

export function subjectTone(subject: string | null | undefined): string | undefined {
  if (!subject) return undefined;
  // FNV-1a: espalha melhor nomes parecidos entre as cores.
  let h = 2166136261;
  for (const c of subject.trim().toLowerCase()) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return TONES[h % TONES.length];
}
