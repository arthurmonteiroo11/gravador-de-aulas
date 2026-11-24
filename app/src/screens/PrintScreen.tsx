import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { Lesson } from '../lib/types';
import { getLesson } from '../lessons/api';
import { loadLessonContent, type LessonContent } from '../lessons/content';
import { formatDuration } from '../lessons/format';
import Icon from '../components/Icon';

type Props = { lessonId: string; onBack: () => void };

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

/**
 * A aula em formato de documento, pronta para virar PDF.
 * No iPhone, "Salvar em PDF" abre a impressão; ali, Compartilhar > Salvar em Arquivos guarda o PDF.
 */
export default function PrintScreen({ lessonId, onBack }: Props) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [content, setContent] = useState<LessonContent | null>(null);
  const [parts, setParts] = useState({ summary: true, rewrite: true, notes: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getLesson(lessonId), loadLessonContent(lessonId)])
      .then(([l, c]) => {
        setLesson(l);
        setContent(c);
      })
      .catch(() => setError('Não deu para abrir a aula. Verifique a internet.'));
  }, [lessonId]);

  // O nome sugerido para o PDF vem do título da página.
  useEffect(() => {
    if (!lesson) return;
    const before = document.title;
    document.title = lesson.title;
    return () => {
      document.title = before;
    };
  }, [lesson]);

  const back = (
    <button className="back no-print" onClick={onBack} aria-label="Voltar">
      <Icon name="back" size={20} />
      Aula
    </button>
  );
  if (!lesson || !content) return <section>{back}<p className={error ? 'notice' : 'muted'}>{error ?? 'Carregando…'}</p></section>;

  const notes = (lesson.notes ?? '').trim();
  const available = { summary: Boolean(content.summary), rewrite: Boolean(content.rewrite), notes: Boolean(notes) };
  const nothing = !Object.entries(parts).some(([k, on]) => on && available[k as keyof typeof available]);
  const toggle = (k: keyof typeof parts) => setParts((p) => ({ ...p, [k]: !p[k] }));

  return (
    <section className="enter print-view">
      {back}
      <div className="no-print print-options">
        <p className="section-label">O que vai no PDF</p>
        <div className="chips" role="group" aria-label="Partes do PDF">
          {(
            [
              ['summary', 'Resumo'],
              ['rewrite', 'Reescrita'],
              ['notes', 'Anotações'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className="chip" aria-pressed={parts[k] && available[k]} disabled={!available[k]} onClick={() => toggle(k)}>
              {parts[k] && available[k] && <Icon name="check" size={14} />}
              {label}
            </button>
          ))}
        </div>
        <div className="actions">
          <button className="primary grow" onClick={() => window.print()} disabled={nothing}>
            <Icon name="doc" size={18} />
            Salvar em PDF
          </button>
        </div>
        <p className="muted hint">No iPhone, abre a tela de impressão. Toque em Compartilhar e depois em Salvar em Arquivos.</p>
      </div>

      <article className="paper">
        <header>
          <p className="paper-kicker">{[lesson.subject, longDate(lesson.recorded_at), formatDuration(lesson.duration_s)].filter(Boolean).join(', ')}</p>
          <h1>{lesson.title}</h1>
        </header>
        {parts.summary && content.summary && (
          <section>
            <h2>Resumo</h2>
            <Markdown>{content.summary}</Markdown>
          </section>
        )}
        {parts.rewrite && content.rewrite && (
          <section>
            <h2>Aula reescrita</h2>
            <Markdown components={{ h1: 'h3', h2: 'h3' }}>{content.rewrite}</Markdown>
          </section>
        )}
        {parts.notes && notes && (
          <section>
            <h2>Minhas anotações</h2>
            <p className="paper-notes">{notes}</p>
          </section>
        )}
      </article>
    </section>
  );
}
