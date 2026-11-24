import { useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import { askLessons, chatKey, historyOf, MAX_QUESTION_CHARS, saveChat, savedChat, splitCitations, type AskAnswer, type ChatItem } from '../lessons/ask';
import { formatClock } from '../lessons/format';
import Icon from '../components/Icon';

type Props = {
  lessonIds: string[];
  /** Título da aula, ou o nome da pasta no modo prova. */
  title: string;
  onBack: () => void;
  onOpenSource: (lessonId: string, startS: number) => void;
};

const SUGGESTIONS = ['Quais foram os pontos principais?', 'O que pode cair na prova?', 'Explique de novo a parte mais difícil.'];

/** Conversa com as aulas: a resposta vem só do que o professor disse, com o trecho e o tempo de cada fonte. */
export default function AskScreen({ lessonIds, title, onBack, onOpenSource }: Props) {
  const key = chatKey(lessonIds);
  // Uma pergunta ainda sem resposta é de uma visita anterior que não esperou: a resposta chega sozinha na memória.
  const [items, setItems] = useState<ChatItem[]>(() => savedChat(key));
  useEffect(() => {
    if (!items.some((i) => !i.answer && !i.error)) return;
    const timer = setInterval(() => setItems(savedChat(key)), 1000);
    return () => clearInterval(timer);
  }, [items, key]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const many = lessonIds.length > 1;

  useEffect(() => {
    if (items.length) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [items.length, busy]);

  // A resposta vai direto para a memória da conversa: se a pessoa sair antes dela chegar, ela aparece na volta.
  const put = (next: ChatItem[]) => {
    saveChat(key, next);
    setItems(next);
  };

  const send = async (text: string, before: ChatItem[] = items) => {
    const q = text.trim().slice(0, MAX_QUESTION_CHARS);
    if (!q || busy) return;
    setQuestion('');
    setBusy(true);
    put([...before, { q }]);
    try {
      const answer = await askLessons(lessonIds, q, historyOf(before));
      put([...before, { q, answer }]);
    } catch (err) {
      put([...before, { q, error: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(question);
  };

  return (
    <section className="enter ask">
      <button className="back" onClick={onBack} aria-label="Voltar">
        <Icon name="back" size={20} />
        Voltar
      </button>
      <h1 className="title">Perguntar</h1>
      <p className="subtitle">
        {many ? `Sobre as ${lessonIds.length} aulas de ${title}.` : `Sobre a aula ${title}.`} A resposta usa só o que o professor disse e mostra de onde veio.
      </p>

      <div className="chat" aria-live="polite">
        {items.length === 0 && (
          <div className="ask-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => void send(s)} disabled={busy}>{s}</button>
            ))}
          </div>
        )}
        {items.map((item, i) => (
          <div key={i} className="turn">
            <p className="bubble-q">{item.q}</p>
            {item.answer ? (
              <Answer answer={item.answer} many={many} onOpenSource={onOpenSource} />
            ) : item.error ? (
              <div className="bubble-a">
                <p className="notice" role="alert">{item.error}</p>
                <button className="ghost small-link" onClick={() => void send(item.q, items.filter((_, k) => k !== i))} disabled={busy}>
                  Tentar de novo
                </button>
              </div>
            ) : (
              <div className="bubble-a thinking" aria-label="Pensando">
                <span /><span /><span />
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="ask-bar" onSubmit={submit}>
        <textarea
          aria-label="Sua pergunta"
          placeholder={many ? 'Pergunte sobre a matéria…' : 'Pergunte sobre a aula…'}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(question);
            }
          }}
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          enterKeyHint="send"
        />
        <button className="primary send" type="submit" disabled={busy || !question.trim()} aria-label="Enviar pergunta">
          <Icon name="send" size={20} />
        </button>
      </form>
    </section>
  );
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => String(n).split('').map((d) => SUP[Number(d)]).join('');

function Answer({ answer, many, onOpenSource }: { answer: AskAnswer; many: boolean; onOpenSource: Props['onOpenSource'] }) {
  const byN = new Map(answer.sources.map((s) => [s.n, s]));
  // "[1]" no texto vira um número pequeno, como nota de rodapé.
  const text = splitCitations(answer.answer).map((p) => (typeof p === 'number' ? (byN.has(p) ? sup(p) : '') : p))
    .join('')
    .replace(/\s+(?=[⁰¹²³⁴⁵⁶⁷⁸⁹])/g, '');
  return (
    <div className="bubble-a">
      <div className="reading answer-text"><Markdown>{text}</Markdown></div>
      {answer.sources.length > 0 && (
        <ol className="sources" aria-label="Fontes">
          {answer.sources.map((s) => (
            <li key={s.n}>
              <button className="source" onClick={() => onOpenSource(s.lessonId, s.startS)}>
                <span className="source-n">{s.n}</span>
                <span className="source-text">
                  <strong>{many ? `${s.title}, ` : ''}{formatClock(s.startS)}</strong>
                  {s.quote && <em>“{s.quote}”</em>}
                </span>
                <Icon name="play" size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
