import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Lesson } from '../lib/types';
import { deleteLessons, listLessons, requestProcessing } from '../lessons/api';
import { finalizeAbandoned } from '../lessons/recovery';
import { formatDay, formatDuration, statusLabel } from '../lessons/format';
import { startPoller } from '../lessons/poller';
import { retryLesson, isWaitingForGemini } from '../lessons/retry';
import { describeLoadError } from '../lessons/errors';
import { errorText, recordProblem } from '../lib/diagnostics';
import { filterLessons, searchText, splitMatches, type TextHit } from '../lessons/search';
import { listFolders, mergeFolders } from '../lessons/folders';
import { dueCount } from '../lessons/flashcards';
import { subjectTone } from '../lessons/subjectTone';
import Icon from '../components/Icon';
import ThemeButton from '../components/ThemeButton';
import Sheet from '../components/Sheet';
import ExamCard from '../components/ExamCard';
import { combineLessons, listStudyNotes, type StudyNote } from '../lessons/study';

export type OpenFocus = { query?: string; startS?: number | null; tab?: 'summary' | 'rewrite' | 'transcript' | 'notes' };
type Props = {
  onRecord: () => void;
  onOpen: (id: string, focus?: OpenFocus) => void;
  onSubjects?: (subjects: string[]) => void;
  onOpenStudy: (id: string) => void;
  onImport?: () => void;
  onReview?: () => void;
  onFolders?: () => void;
  onAccount?: () => void;
  onExamCards?: (subject: string, lessonIds: string[]) => void;
  onAsk?: (lessonIds: string[], title: string) => void;
};

/** Modo prova usa no máximo as 8 aulas mais recentes: o mesmo limite do resumo combinado. */
const EXAM_LESSONS = 8;
let lastSubject: string | null = null;

/** Mesma pasta, mesmas aulas, mesma chave: repetir o resumo da matéria não gasta cota de novo. */
async function examKey(ids: string[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...ids].sort().join(','))));
  return 'prova-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

const POLL_MS = 10_000;
const SEARCH_DELAY_MS = 250;
const WHERE: Record<TextHit['where'], string> = { transcript: 'Na transcrição', summary: 'No resumo', rewrite: 'Na reescrita', notes: 'Nas anotações' };

const tone = (subject: string | null) => ({ '--tone': subjectTone(subject) }) as CSSProperties;

export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export default function LessonsScreen({ onRecord, onOpen, onSubjects, onOpenStudy, onImport, onReview, onFolders, onExamCards, onAsk, onAccount }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // A pasta escolhida continua escolhida ao voltar de outra tela.
  const [subject, setSubjectState] = useState<string | null>(lastSubject);
  const setSubject = (s: string | null) => {
    lastSubject = s;
    setSubjectState(s);
  };
  const [hits, setHits] = useState<TextHit[]>([]);
  const [studies, setStudies] = useState<StudyNote[]>([]);
  // null: modo normal. Um conjunto: escolhendo aulas para juntar.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [combining, setCombining] = useState(false);

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
    // Sem a tabela nova no banco, a lista de aulas continua funcionando.
    listStudyNotes().then(setStudies).catch(() => setStudies([]));
  }, []);

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

  const [savedFolders, setSavedFolders] = useState<string[]>([]);
  const [due, setDue] = useState(0);
  useEffect(() => {
    listFolders().then(setSavedFolders).catch(() => {});
    dueCount().then(setDue).catch(() => setDue(0));
  }, []);
  const subjects = useMemo(() => mergeFolders(savedFolders, lessons ?? []), [savedFolders, lessons]);
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

  const shownStudies = studies.filter((n) => {
    const ls = n.lesson_ids.map((id) => byId.get(id)).filter((l): l is Lesson => Boolean(l));
    return (!subject || ls.some((l) => l.subject === subject)) && filterLessons([{ title: n.title, subject: null }], { subject: null, query }).length > 0;
  });


  const toggle = (id: string) => {
    if (!picked) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  // Só contam as escolhidas que estão à vista (a busca ou o filtro podem esconder alguma).
  const chosen = picked ? shown.filter((l) => picked.has(l.id) && l.status === 'ready').map((l) => l.id) : [];
  const toDelete = picked ? shown.filter((l) => picked.has(l.id)) : [];
  const busySelecting = combining || deleting !== null;

  const removeChosen = async () => {
    setDeleting(0);
    setError(null);
    const failed = await deleteLessons(toDelete, (n) => alive.current && setDeleting(n));
    if (!alive.current) return;
    setDeleting(null);
    setConfirmDelete(false);
    void refresh();
    if (failed.length) {
      setPicked(new Set(failed));
      setError(`Não deu para excluir ${failed.length === 1 ? '1 aula' : `${failed.length} aulas`}. Verifique a internet e tente de novo.`);
    } else setPicked(null);
  };
  const requestKey = useRef<{ ids: string; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const combine = async () => {
    if (chosen.length < 2) return;
    setCombining(true);
    setError(null);
    // Mesma escolha, mesma chave: tentar de novo depois de uma queda não gera um segundo resumo.
    const ids = [...chosen].sort().join(',');
    if (requestKey.current?.ids !== ids) requestKey.current = { ids, key: crypto.randomUUID() };
    try {
      const id = await combineLessons(chosen, requestKey.current.key);
      if (alive.current) onOpenStudy(id);
    } catch (err) {
      if (!alive.current) return;
      setError((err as Error).message);
      setCombining(false);
      listStudyNotes().then(setStudies).catch(() => {});
    }
  };

  const readyInSubject = subject
    ? (lessons ?? []).filter((l) => l.subject === subject && l.status === 'ready').sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
    : [];
  const examLessons = readyInSubject.slice(0, EXAM_LESSONS);
  const examIds = examLessons.map((l) => l.id);

  const examSummary = async () => {
    const ids = [...examIds].sort();
    // Já existe um resumo destas mesmas aulas: abre sem chamar o Gemini.
    const existing = studies.find((n) => [...n.lesson_ids].sort().join(',') === ids.join(','));
    if (existing) return onOpenStudy(existing.id);
    setCombining(true);
    setError(null);
    try {
      const id = await combineLessons(ids, await examKey(ids));
      if (alive.current) onOpenStudy(id);
    } catch (err) {
      if (!alive.current) return;
      setError((err as Error).message);
      setCombining(false);
    }
  };

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
      <div className="head">
        <h1 className="title">{picked ? 'Selecionar' : 'Aulas'}</h1>
        {!picked && <ThemeButton />}
        {!picked && onAccount && (
          <button className="theme-button account-button" onClick={onAccount} aria-label="Conta, convites e backup">
            <Icon name="person" size={17} />
          </button>
        )}
        {(lessons ?? []).length > 0 && !picked && (
          <button className="ghost" onClick={() => setPicked(new Set())}>Selecionar</button>
        )}
      </div>
      {picked && <p className="subtitle">Escolha aulas para juntar num resumo só, organizado por tema, ou para excluir.</p>}

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

      {!picked && due > 0 && (
        <button className="review-banner" onClick={onReview}>
          <span className="review-icon"><Icon name="cards" size={20} /></span>
          <span>
            <strong>Revisar flashcards</strong>
            <small>{due} {due === 1 ? 'cartão para hoje' : 'cartões para hoje'}</small>
          </span>
        </button>
      )}

      {(subjects.length > 0 || onFolders) && (
        <div className="chips" role="group" aria-label="Filtrar por matéria">
          <button className="chip" aria-pressed={subject === null} onClick={() => setSubject(null)}>Todas</button>
          {subjects.map((s) => (
            <button key={s} className="chip" aria-pressed={subject === s} onClick={() => setSubject(subject === s ? null : s)} style={tone(s)}>
              <span className="dot" />
              {s}
            </button>
          ))}
          {onFolders && !picked && (
            <button className="chip chip-quiet" onClick={onFolders}>
              <Icon name="folder" size={15} />
              Pastas
            </button>
          )}
        </div>
      )}

      {subject && !picked && !query.trim() && examLessons.length > 0 && (
        <ExamCard
          subject={subject}
          count={examLessons.length}
          more={readyInSubject.length > EXAM_LESSONS}
          combining={combining}
          onSummary={() => void examSummary()}
          onCards={() => onExamCards?.(subject, examIds)}
          onAsk={() => onAsk?.(examIds, subject)}
        />
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

        {!picked && shownStudies.length > 0 && (
          <>
            <p className="section-label">Resumos combinados</p>
            <ul className="lesson-list">
              {shownStudies.map((n) => (
                <li key={n.id}>
                  <button className="lesson-row study-row" onClick={() => onOpenStudy(n.id)}>
                    <span className="lesson-title"><Highlight text={n.title} query={query} /></span>
                    <span className="lesson-meta">
                      <span className="stack"><Icon name="stack" size={15} />{n.lesson_ids.length} aulas</span>
                      <span>{formatDay(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!searching && <p className="section-label">Aulas</p>}
          </>
        )}

        {searching && (shown.length > 0 || textHits.length === 0) && (
          <p className="section-label">{shown.length ? 'Aulas' : 'Nada encontrado'}</p>
        )}
        {lessons && lessons.length > 0 && !searching && shown.length === 0 && <p className="muted">Nenhuma aula nessa matéria.</p>}

        <ul className="lesson-list">
          {shown.map((l) => (
            <li key={l.id}>
              <button
                className="lesson-row"
                onClick={() => (picked ? toggle(l.id) : onOpen(l.id, searching ? { query } : undefined))}
                style={tone(l.subject)}
                data-selectable={picked ? 'true' : undefined}
                aria-pressed={picked ? picked.has(l.id) : undefined}
                disabled={busySelecting}
              >
                {picked && <span className="check"><Icon name="check" size={16} /></span>}
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
              {!picked && (l.status === 'error' || l.status === 'recording' || isWaitingForGemini(l)) && (
                <div className="row-actions">
                  {isWaitingForGemini(l) && (
                    <button onClick={() => void requestProcessing(l.id).catch(() => undefined).then(refresh)}>Tentar agora</button>
                  )}
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

      {picked ? (
        <div className="select-bar">
          <button className="ghost" onClick={() => { setPicked(null); setError(null); }} disabled={busySelecting}>Cancelar</button>
          <button className="ghost danger-text" onClick={() => setConfirmDelete(true)} disabled={!toDelete.length || busySelecting} aria-label={toDelete.length ? `Excluir ${toDelete.length} ${toDelete.length === 1 ? 'aula' : 'aulas'}` : 'Excluir'}>
            <Icon name="trash" size={18} />{toDelete.length > 0 && toDelete.length}
          </button>
          <button className="primary" onClick={() => void combine()} disabled={chosen.length < 2 || busySelecting} aria-busy={combining}>
            {combining ? 'Juntando… até 1 min' : chosen.length < 2 ? 'Juntar: 2 ou mais' : `Juntar ${chosen.length} aulas`}
          </button>
        </div>
      ) : (
        <div className="fab-group">
          {onImport && (
            <button className="fab-side" onClick={onImport} aria-label="Importar áudio ou vídeo">
              <Icon name="upload" size={20} />
            </button>
          )}
          <button className="fab" onClick={onRecord}>
            <Icon name="mic" size={20} />
            Gravar aula
          </button>
        </div>
      )}
      {confirmDelete && toDelete.length > 0 && (
        <Sheet title={`Excluir ${toDelete.length} ${toDelete.length === 1 ? 'aula' : 'aulas'}?`} titleId="delete-many-title" onClose={() => deleting === null && setConfirmDelete(false)}>
          <ul className="delete-list">
            {toDelete.slice(0, 6).map((l) => <li key={l.id}>{l.title}</li>)}
            {toDelete.length > 6 && <li className="muted">e mais {toDelete.length - 6}</li>}
          </ul>
          <p className="muted hint sheet-lead">Apaga o áudio, a transcrição, os textos, as anotações e os flashcards. Não dá para desfazer.</p>
          <div className="actions">
            <button className="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting !== null}>Cancelar</button>
            <button className="danger grow" onClick={() => void removeChosen()} disabled={deleting !== null}>
              {deleting !== null ? `Excluindo ${Math.min(deleting + 1, toDelete.length)} de ${toDelete.length}…` : `Excluir ${toDelete.length} ${toDelete.length === 1 ? 'aula' : 'aulas'}`}
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
