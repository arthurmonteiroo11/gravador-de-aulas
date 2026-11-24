export const TRANSCRIBE_PROMPT = `Você vai receber partes de áudio de uma mesma aula em português.
As partes estão em ordem e são minutos consecutivos da aula; cada uma vem depois de um rótulo "Parte N".

Transcreva a fala de quem fala para a turma: o professor e também alunos que perguntam, respondem ou debatem em voz alta.
- Ignore só conversas paralelas baixas, cochichos, ruídos e sons ao fundo.
- Não invente nada. Se uma parte estiver em silêncio, não gere linhas para ela.
- Divida em trechos curtos (uma ou duas frases) e comece um trecho novo sempre que a pessoa que fala mudar.
- Para cada trecho informe: "part" (número da parte), "start" e "end" (segundos desde o início DAQUELA parte), "text" e "speaker".
- "speaker": quem está falando naquele trecho. Preste atenção no timbre, no tom e no jeito de falar: quando a voz muda, o rótulo muda.
  - Use "Professor" só quando estiver claro que é uma aula e essa pessoa ensina; os outros viram "Aluno 1", "Aluno 2"...
  - Em qualquer outro caso (conversa, debate, entrevista, música com mais de um cantor), use "Falante 1", "Falante 2"..., na ordem em que aparecem.
  - Não junte vozes diferentes num rótulo só. A mesma voz mantém o mesmo rótulo em toda a resposta.`;

export const REWRITE_PROMPT = `Abaixo está a transcrição de uma aula em português, com marcação de tempo.

Gere dois textos em Markdown, em português:
1. "rewrite": a aula reescrita de forma organizada e fácil de estudar, com títulos por tópico, corrigindo vícios de fala e repetições. Não invente conteúdo que não foi dito. Se a transcrição marcar mais de uma pessoa (perguntas de alunos, debate), mantenha quem defendeu o quê, citando o rótulo de quem falou.
2. "summary": um resumo com no máximo 15 tópicos curtos, com os pontos mais importantes da aula.

Transcrição:
`;

export const COMBINE_PROMPT = `Abaixo estão os textos de várias aulas em português, em ordem de data.

Junte o conteúdo num único material de estudo em Markdown, em português:
- Organize por tema, com títulos, e não aula por aula. Quando um assunto continua de uma aula para outra, una as partes.
- Mantenha definições, exemplos, datas e fórmulas. Corte repetições.
- Termine com uma seção "## Pontos principais" com no máximo 12 tópicos curtos.
- Não invente conteúdo que não está nos textos.

Responda com "title" (um título curto para o material, sem data) e "content" (o Markdown).

Aulas:
`;

export const FLASHCARDS_PROMPT = `Abaixo está o material de uma aula em português.

Crie flashcards para estudar esse conteúdo, em português:
- Entre 8 e 15 cartões, cobrindo os pontos mais importantes, sem repetir.
- "front": uma pergunta curta e direta (no máximo 20 palavras). Nada de "Segundo o professor...".
- "back": a resposta em uma ou duas frases curtas.
- Prefira definições, causas e consequências, fórmulas, datas e comparações.
- Não invente nada que não esteja no material.

Material:
`;

export const ASK_PROMPT = `Você é um monitor que ajuda um aluno a estudar. Responda à pergunta usando SOMENTE as transcrições de aula abaixo.
Cada linha começa com uma etiqueta [A<n> <tempo>]: A<n> é a aula e <tempo> é o momento em que aquilo foi dito. Se a linha tiver um nome antes do texto (ex.: "Aluno 1:"), foi essa pessoa que falou.

Regras:
- Responda em português, de forma clara e curta (no máximo uns 8 tópicos ou 3 parágrafos), em Markdown.
- Use só o que está nas aulas. Se a resposta não estiver nelas, diga "Isso não aparece nas aulas." e sugira o que mais perto disso foi dito, se houver.
- Marque no texto de onde veio cada informação com [1], [2]... e liste essas fontes em "sources".
- Em cada fonte: "n" (o número usado no texto), "lesson" (a etiqueta da aula, ex.: "A1"), "time" (o tempo exatamente como aparece na etiqueta da linha, ex.: "12:34") e "quote" (um trecho curto, de até 20 palavras, copiado da linha).
- No máximo 5 fontes.
`;
