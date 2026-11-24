import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Lesson } from '../lib/types';
import { listLessons, requestProcessing } from '../lessons/api';
import { finalizeAbandoned } from '../lessons/recovery';
import { formatDay, formatDuration, statusLabel } from '../lessons/format';
import { startPoller } from '../lessons/poller';
import { retryLesson } from '../lessons/retry';
import { describeLoadError } from '../lessons/errors';
import { errorText, recordProblem } from '../lib/diagnostics';
import { filterLessons, searchText, splitMatches, subjectsOf, type TextHit } from '../lessons/search';
import { subjectTone } from '../lessons/subjectTone';
import Icon from '../components/Icon';

export type OpenFocus = { query?: string; startS?: number | null; tab?: 'summary' | 'rewrite' | 'transcript' };
type Props = {
  onRecord: () => void;
  onOpen: (id: string, focus?: OpenFocus) => void;
  onSubjects?: (subjects: string[]) => void;
};

const POLL_MS = 10_000;
const SEARCH_DELAY_MS = 250;
const WHERE: Record<TextHit['where'], string> = { transcript: 'Na transcrição', summary: 'No resumo', rewrite: 'Na reescrita' };

const tone = (subject: string | null) => ({ '--tone': subjectTone(subject) }) as CSSProperties;

export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export default function LessonsScreen({ onRecord, onOpen, onSubjects }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [hits, setHits] = useState<TextHit[]>([]);

  const refresh = useCallback(async () => {
    try {
      setLessons(await listLessons());
      setError(null);
    } catch (err) {
      setError(describeLoadError(err));
    }
  }, []);

  const lessonsRef = useRef<Lesson[] | null>(null);
  lessonsRef.current = lessons;

  // Enquanto o app está aberto, empurra o processamento das aulas pendentes, uma rodada por vez.
  useEffect(() => {
    void refresh();
    return startPoller(async () => {
      const pending = (lessonsRef.current ?? []).filter((l) => l.status === 'uploading' || l.status === 'processing');
      for (const l of pending) {
        try {
          await requestProcessing(l.id);
          recordProblem('processing', null);
        } catch (err) {
          // Tenta de novo no próximo ciclo; o erro aparece na tela da aula.
          recordProblem('processing', await errorText(err));
        }
      }
      if (pending.length) await refresh();
    }, POLL_MS);
  }, [refresh]);

  const subjects = useMemo(() => subjectsOf(lessons ?? []), [lessons]);
  useEffect(() => {
    onSubjects?.(subjects);
  }, [subjects, onSubjects]);

  // Busca no texto das aulas, esperando a pessoa parar de digitar.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      searchText(q)
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]));
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const byId = useMemo(() => new Map((lessons ?? []).map((l) => [l.id, l])), [lessons]);
  const shown = filterLessons(lessons ?? [], { subject, query });
  const textHits = hits.filter((h) => {
    const l = byId.get(h.lessonId);
    return l && (!subject || l.subject === subject);
  });
  const searching = query.trim().length >= 2;

  const finalize = async (id: string) => {
    try {
      await finalizeAbandoned(id);
      void refresh();
    } catch {
      setError('Não foi possível finalizar. Verifique a internet e tente de novo.');
    }
  };

  return (
    <section className="enter">
      <h1 className="title">Aulas</h1>

      <div className="search">
        <Icon name="search" size={18} />
        <input
          type="search"
          aria-label="Buscar nas aulas"
          placeholder="Buscar nas aulas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
      </div>

      {subjects.length > 0 && (
        <div className="chips" role="group" aria-label="Filtrar por matéria">
          <button className="chip" aria-pressed={subject === null} onClick={() => setSubject(null)}>Todas</button>
          {subjects.map((s) => (
            <button key={s} className="chip" aria-pressed={subject === s} onClick={() => setSubject(subject === s ? null : s)} style={tone(s)}>
              <span className="dot" />
              {s}
            </button>
          ))}
        </div>
      )}

      <div>
        {error && <p className="notice">{error}</p>}
        {lessons === null && !error && <p className="muted">Carregando…</p>}

        {lessons?.length === 0 && (
          <div className="empty">
            <p className="title">Nenhuma aula ainda</p>
            <p>Toque em Gravar aula quando o professor começar.</p>
          </div>
        )}

        {searching && textHits.length > 0 && (
          <>
            <p className="section-label">Encontrado no texto</p>
            <ul className="lesson-list fade-in">
              {textHits.slice(0, 20).map((h, i) => {
                const l = byId.get(h.lessonId)!;
                return (
                  <li key={`${h.lessonId}-${h.where}-${i}`}>
                    <button className="hit" onClick={() => onOpen(h.lessonId, { query, startS: h.startS, tab: h.where })}>
                      <span className="where">
                        {l.title}, {WHERE[h.where].toLowerCase()}
                      </span>
                      <span className="snippet"><Highlight text={h.snippet} query={query} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {searching && (shown.length > 0 || textHits.length === 0) && (
          <p className="section-label">{shown.length ? 'Aulas' : 'Nada encontrado'}</p>
        )}
        {lessons && lessons.length > 0 && !searching && shown.length === 0 && <p className="muted">Nenhuma aula nessa matéria.</p>}

        <ul className="lesson-list">
          {shown.map((l) => (
            <li key={l.id}>
              <button className="lesson-row" onClick={() => onOpen(l.id, searching ? { query } : undefined)} style={tone(l.subject)}>
                <span className="lesson-title"><Highlight text={l.title} query={query} /></span>
                <span className="lesson-meta">
                  {l.subject && (
                    <span className="subject"><span className="dot" />{l.subject}</span>
                  )}
                  <span>{formatDay(l.recorded_at)}</span>
                  <span className="num">{formatDuration(l.duration_s)}</span>
                  {l.status !== 'ready' && <span className="status" data-state={l.status}>{statusLabel(l)}</span>}
                </span>
                {l.status === 'processing' && l.error_message && <span className="muted" style={{ fontSize: '0.85rem' }}>{l.error_message}</span>}
              </button>
              {(l.status === 'error' || l.status === 'recording') && (
                <div className="row-actions">
                  {l.status === 'error' && (
                    <button onClick={() => void retryLesson(l).then(refresh).catch(() => setError('Não foi possível tentar de novo.'))}>
                      Tentar de novo
                    </button>
                  )}
                  {l.status === 'recording' && <button onClick={() => finalize(l.id)}>Finalizar gravação interrompida</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <button className="fab" onClick={onRecord}>
        <Icon name="mic" size={20} />
        Gravar aula
      </button>
    </section>
  );
}
