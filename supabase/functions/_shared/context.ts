/** Termos da matéria: a pessoa escreve uma lista por pasta e ela vai junto para o Gemini. */
export const MAX_TERMS_CHARS = 2000;
const MAX_TERMS = 150;

/** Separa por vírgula, ponto e vírgula ou linha; tira vazios e repetidos. */
export function parseTerms(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of (raw ?? '').slice(0, MAX_TERMS_CHARS).split(/[,;\n]+/)) {
    const term = t.replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = term.toLocaleLowerCase('pt-BR');
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.slice(0, MAX_TERMS);
}

/** Parágrafo de contexto para o pedido. Vazio quando não há matéria nem termos. */
export function contextNote(subject: string | null | undefined, terms: string | null | undefined): string {
  const name = (subject ?? '').trim();
  const list = parseTerms(terms);
  if (!name && !list.length) return '';
  const lines = ['Contexto da aula:'];
  if (name) lines.push(`- Matéria: ${name}.`);
  if (list.length) {
    lines.push(`- Termos que costumam aparecer nesta matéria: ${list.join('; ')}.`);
    lines.push('- Quando ouvir algo parecido com um desses termos, use exatamente esta grafia. Não force um termo que não foi dito.');
  }
  return lines.join('\n');
}
