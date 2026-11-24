import type { CSSProperties } from 'react';
import { subjectTone } from '../lessons/subjectTone';
import Icon from './Icon';

type Props = {
  subject: string;
  /** Aulas prontas da pasta, as mais recentes primeiro (no máximo 8). */
  count: number;
  more: boolean;
  combining: boolean;
  onSummary: () => void;
  onCards: () => void;
  onAsk: () => void;
};

/** Modo prova: atalhos para estudar a pasta inteira de uma vez. */
export default function ExamCard({ subject, count, more, combining, onSummary, onCards, onAsk }: Props) {
  return (
    <section className="exam-card" style={{ '--tone': subjectTone(subject) } as CSSProperties} aria-labelledby="exam-title">
      <div className="exam-head">
        <span className="exam-icon"><Icon name="target" size={20} /></span>
        <span>
          <strong id="exam-title">Estudar {subject} para a prova</strong>
          <small>
            {count === 1 ? '1 aula pronta' : `${more ? 'As ' : ''}${count} aulas prontas${more ? ' mais recentes' : ''}`}
          </small>
        </span>
      </div>
      <div className="exam-actions">
        {count > 1 && (
          <button className="pill" onClick={onSummary} disabled={combining} aria-busy={combining}>
            <Icon name="doc" size={16} />
            {combining ? 'Montando… até 1 min' : 'Resumo da matéria'}
          </button>
        )}
        <button className="pill" onClick={onCards} disabled={combining}>
          <Icon name="cards" size={16} />
          Flashcards
        </button>
        <button className="pill" onClick={onAsk} disabled={combining}>
          <Icon name="chat" size={16} />
          Perguntar
        </button>
      </div>
    </section>
  );
}
