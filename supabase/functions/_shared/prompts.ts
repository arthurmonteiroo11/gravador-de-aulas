export const TRANSCRIBE_PROMPT = `Você vai receber partes de áudio de uma mesma aula em português.
As partes estão em ordem e são minutos consecutivos da aula; cada uma vem depois de um rótulo "Parte N".

Transcreva somente a fala do professor (a voz principal, que dá a aula).
- Ignore conversas paralelas de alunos, ruídos e sons ao fundo.
- Não invente nada. Se uma parte estiver em silêncio ou sem fala do professor, não gere linhas para ela.
- Divida em trechos curtos (uma ou duas frases).
- Para cada trecho informe: "part" (número da parte), "start" e "end" (segundos desde o início DAQUELA parte) e "text".`;

export const REWRITE_PROMPT = `Abaixo está a transcrição de uma aula em português, com marcação de tempo.

Gere dois textos em Markdown, em português:
1. "rewrite": a aula reescrita de forma organizada e fácil de estudar, com títulos por tópico, corrigindo vícios de fala e repetições. Não invente conteúdo que o professor não disse.
2. "summary": um resumo com no máximo 15 tópicos curtos, com os pontos mais importantes da aula.

Transcrição:
`;
