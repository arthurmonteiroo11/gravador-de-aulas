import { useEffect, useState } from 'react';
import { cardsOfLesson, createFlashcards, dueCards, gradeCard, nextReview, type Flashcard } from '../lessons/flashcards';
import Icon from '../components/Icon';

type Props = {
  /** Uma aula: revisa todos os cartões dela. Sem aula: só os que venceram, de todas. */
  lessonId?: string;
  title: string;
  onBack: () => void;
};

/** right: acertou de primeira. missed: errou pelo menos uma vez nesta rodada. */
type Round = { queue: Flashcard[]; total: number; right: number; missed: string[] };

/** Revisão: mostra a pergunta, vira para a resposta e a pessoa diz se acertou. */
export default function ReviewScreen({ lessonId, title, onBack }: Props) {
  const [round, setRound] = useState<Round | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaking, setRemaking] = useState(false);
  const [confirmRemake, setConfirmRemake] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const cards = lessonId ? await cardsOfLesson(lessonId) : await dueCards();
      setRound({ queue: cards, total: cards.length, right: 0, missed: [] });
      setFlipped(false);
    } catch {
      setError('Não deu para abrir os cartões. Verifique a internet.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  useEffect(() => {
    if (!confirmRemake) return;
    const timer = setTimeout(() => setConfirmRemake(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmRemake]);

  const answer = async (correct: boolean) => {
    if (!round?.queue.length) return;
    const [card, ...rest] = round.queue;
    const missedBefore = round.missed.includes(card.id);
    setFlipped(false);
    // Errou: o cartão volta para o fim da fila, já na caixa 1, como ficou salvo.
    setRound({
      ...round,
      queue: correct ? rest : [...rest, { ...card, ...nextReview(card.box, false) }],
      right: round.right + (correct && !missedBefore ? 1 : 0),
      missed: correct || missedBefore ? round.missed : [...round.missed, card.id],
    });
    // Já errou nesta rodada: está salvo na caixa 1, para amanhã. Acertar depois não sobe de caixa.
    if (missedBefore) return;
    try {
      await gradeCard(card, correct);
    } catch {
      setError('Sem internet: esta resposta não ficou salva.');
    }
  };

  const remake = async () => {
    if (!lessonId) return;
    if (!confirmRemake) return setConfirmRemake(true);
    setConfirmRemake(false);
    setRemaking(true);
    setError(null);
    try {
      await createFlashcards(lessonId, true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemaking(false);
    }
  };

  const back = (
    <button className="back" onClick={onBack} aria-label="Voltar">
      <Icon name="back" size={20} />
      Voltar
    </button>
  );

  if (!round) return <section>{back}<p className={error ? 'notice' : 'muted'}>{error ?? 'Carregando…'}</p></section>;

  const card = round.queue[0];
  const done = round.total - round.queue.length;
  const finished = !card;

  return (
    <section className="enter review">
      {back}
      <h1 className="title">{lessonId ? title : 'Revisar'}</h1>
      <div className="review-progress" aria-label={`${done} de ${round.total} cartões`}>
        <div className="progress"><span style={{ width: `${round.total ? (done / round.total) * 100 : 0}%` }} /></div>
        <span className="num">{done}/{round.total}</span>
      </div>

      {error && <p className="notice" role="alert">{error}</p>}

      {round.total === 0 ? (
        <div className="empty">
          <p className="title">Nada para revisar hoje</p>
          <p>Os cartões voltam no dia certo: quanto mais você acerta, mais tempo eles demoram para aparecer.</p>
        </div>
      ) : finished ? (
        <div className="empty fade-in">
          <p className="title">Pronto por hoje</p>
          <p>
            {round.right} de primeira{round.missed.length ? `, ${round.missed.length} ${round.missed.length === 1 ? 'precisou' : 'precisaram'} de mais uma volta` : ''}.
            Os cartões voltam no dia certo para você não esquecer.
          </p>
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button className="primary" onClick={onBack}>Concluir</button>
          </div>
        </div>
      ) : (
        <>
          <button
            key={card.id + round.queue.length}
            className="flashcard fade-in"
            data-flipped={flipped}
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? `Resposta: ${card.back}` : `Pergunta: ${card.front}. Toque para ver a resposta.`}
          >
            <span className="face front">
              <small>Pergunta</small>
              <span>{card.front}</span>
              <em>Toque para ver a resposta</em>
            </span>
            <span className="face back">
              <small>Resposta</small>
              <span>{card.back}</span>
            </span>
          </button>
          <div className="grade" data-shown={flipped}>
            <button className="wrong" onClick={() => void answer(false)} disabled={!flipped}>Errei</button>
            <button className="right" onClick={() => void answer(true)} disabled={!flipped}>Acertei</button>
          </div>
        </>
      )}

      {lessonId && (
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="ghost" onClick={() => void remake()} disabled={remaking} aria-live="polite">
            {remaking ? 'Criando cartões novos…' : confirmRemake ? 'Toque de novo para trocar todos os cartões' : 'Criar cartões novos'}
          </button>
        </div>
      )}
    </section>
  );
}
