import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lesson } from '../lib/types';
import { getLesson, requestProcessing } from '../lessons/api';
import { pendingKeys } from '../storage/localQueue';
import { useWide } from '../lib/useWide';
import AskScreen from './AskScreen';
import { errorText, lastProblems, recordProblem } from '../lib/diagnostics';
import PipelineStatus from '../components/PipelineStatus';
import { uploadPending } from '../storage/uploader';
import { supabase } from '../lib/supabase';
import { loadLessonContent, signedUrls, type LessonContent } from '../lessons/content';
import { lessonLength, lessonTime, locate } from '../lessons/playback';
import { formatClock, formatDay, formatDuration, statusLabel } from '../lessons/format';
import { subjectTone } from '../lessons/subjectTone';
import { Highlight, type OpenFocus } from './LessonsScreen';
import Icon from '../components/Icon';
import LessonActions from '../components/LessonActions';
import { EditableList, EditableMarkdown, NotesEditor } from '../components/Editable';
import { saveNotes, saveOutput, saveSegment } from '../lessons/study';
import { useAutosave } from '../lessons/useAutosave';
import type { CSSProperties } from 'react';

type Tab = 'summary' | 'rewrite' | 'transcript' | 'notes';
const TABS: Array<[Tab, string]> = [['summary', 'Resumo'], ['rewrite', 'Reescrita'], ['transcript', 'Transcrição'], ['notes', 'Anotações']];

type Props = {
  lessonId: string;
  onBack: () => void;
  focus?: OpenFocus;
  folders?: string[];
  onReview?: (lessonId: string, title: string) => void;
  onPrint?: (lessonId: string) => void;
  onAsk?: (lessonId: string, title: string) => void;
  onDeleted?: () => void;
};

export default function LessonScreen({ lessonId, onBack, focus, folders = [], onReview, onPrint, onAsk, onDeleted }: Props) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [content, setContent] = useState<LessonContent | null>(null);
  const [tab, setTab] = useState<Tab>(focus?.tab ?? 'summary');
  const query = focus?.query ?? '';
  const scrolled = useRef(false);
  // Trecho em destaque na transcrição: vem da busca, de uma fonte de pergunta ou da coluna ao lado.
  const [focusAt, setFocusAt] = useState<number | null>(focus?.startS ?? null);
  const wide = useWide();
  const [side, setSide] = useState<'notes' | 'ask'>('notes');
  const [urls, setUrls] = useState<Map<number, string>>(new Map());
  const [onDevice, setOnDevice] = useState(0);
  const [problems, setProblems] = useState(lastProblems());
  const [sending, setSending] = useState(false);
  const [reload, setReload] = useState(0);

  const sendNow = async () => {
    setSending(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user) await uploadPending(data.user.id);
    } catch (err) {
      recordProblem('upload', await errorText(err));
    } finally {
      setSending(false);
      setReload((n) => n + 1);
    }
  };
  const audio = useRef<HTMLAudioElement>(null);
  const playingIdx = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const l = await getLesson(lessonId);
      // Enquanto esta tela está aberta, ela mesma empurra o processamento.
      if (l.status === 'uploading' || l.status === 'processing') {
        try {
          await requestProcessing(lessonId);
          recordProblem('processing', null);
        } catch (err) {
          recordProblem('processing', await errorText(err));
        }
      }
      const c = await loadLessonContent(lessonId);
      const pending = await pendingKeys(lessonId).catch(async (err) => {
        recordProblem('upload', `Não consegui ler as partes salvas no aparelho: ${await errorText(err)}`);
        return [];
      });
      if (!alive) return;
      setOnDevice(pending.length);
      setProblems(lastProblems());
      done.current = l.status === 'ready' || l.status === 'error';
      setLesson(l);
      setContent(c);
      if (!l.audio_deleted) setUrls(await signedUrls(c.chunks));
    };
    void load();
    // Atualiza só enquanto a aula ainda está sendo preparada.
    const timer = setInterval(() => {
      if (!done.current) void load();
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [lessonId, reload]);

  // Abas com alteração ainda não salva: sair da tela pede confirmação.
  const dirty = useRef(new Set<Tab>());
  const markDirty = useMemo(() => {
    const make = (t: Tab) => (d: boolean) => void (d ? dirty.current.add(t) : dirty.current.delete(t));
    return { summary: make('summary'), rewrite: make('rewrite'), transcript: make('transcript') };
  }, []);
  const leave = () => {
    if (dirty.current.size && !window.confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
    onBack();
  };
  const storeOutput = (kind: 'summary' | 'rewrite') => async (md: string) => {
    await saveOutput(lessonId, kind, md);
    setContent((c) => c && { ...c, [kind]: md });
  };
  const storeSegments = async (changed: Array<{ key: number; text: string }>) => {
    await Promise.all(changed.map((c) => saveSegment(c.key, c.text)));
    const byId = new Map(changed.map((c) => [c.key, c.text]));
    setContent((c) => c && { ...c, segments: c.segments.map((s) => (s.id != null && byId.has(s.id) ? { ...s, text: byId.get(s.id)! } : s)) });
  };

  const playChunk = (idx: number, offset: number) => {
    const el = audio.current;
    const src = urls.get(idx);
    if (!el || !src) return;
    playingIdx.current = idx;
    el.src = src;
    el.onloadedmetadata = () => {
      el.currentTime = offset;
      void el.play();
    };
    el.load();
  };

  const playAt = (t: number) => {
    const spot = content && locate(content.chunks, t);
    if (spot) playChunk(spot.idx, spot.offset);
  };

  // Ao terminar uma parte, toca a próxima: o áudio soa como uma gravação só.
  const playNext = () => {
    const next = content?.chunks.find((c) => c.idx === (playingIdx.current ?? -1) + 1);
    if (next) playChunk(next.idx, 0);
  };

  const togglePlay = () => {
    const el = audio.current;
    if (!el) return;
    if (playingIdx.current === null) return playAt(0);
    if (el.paused) void el.play();
    else el.pause();
  };

  const back = (
    <button className="back" onClick={leave} aria-label="Voltar">
      <Icon name="back" size={20} />
      Aulas
    </button>
  );
  if (!lesson || !content) return <section>{back}<p className="muted">Carregando…</p></section>;

  const pendingText = lesson.status === 'error' ? `Erro: ${lesson.error_message ?? 'tente de novo mais tarde.'}` : `${statusLabel(lesson)}…`;
  const total = lessonLength(content.chunks);
  // No computador, as anotações moram na coluna ao lado; as abas ficam só com o texto da aula.
  const tabs = wide ? TABS.filter(([k]) => k !== 'notes') : TABS;
  const shownTab: Tab = wide && tab === 'notes' ? 'summary' : tab;
  const tabIndex = tabs.findIndex(([k]) => k === shownTab);
  const goTo = (startS: number) => {
    scrolled.current = false;
    setFocusAt(startS);
    setTab('transcript');
  };

  const main = (
    <div className="lesson-main">
      {back}
      <h1 className="title">{lesson.title}</h1>
      <p className="meta-line">
        {lesson.subject && (
          <span className="subject" style={{ '--tone': subjectTone(lesson.subject) } as CSSProperties}>
            <span className="dot" />
            {lesson.subject}
          </span>
        )}
        <span>{formatDay(lesson.recorded_at)}</span>
        <span className="num">{formatDuration(lesson.duration_s)}</span>
        {lesson.status !== 'ready' && <span>{statusLabel(lesson)}</span>}
      </p>

      <div>
        <LessonActions
          lesson={lesson}
          chunks={content.chunks}
          urls={urls}
          folders={folders}
          onReview={() => onReview?.(lesson.id, lesson.title)}
          onPrint={() => onPrint?.(lesson.id)}
          onAsk={() => (wide ? setSide('ask') : onAsk?.(lesson.id, lesson.title))}
          onChanged={(patch) => setLesson((l) => l && { ...l, ...patch })}
          onDeleted={() => (onDeleted ?? onBack)()}
        />
      </div>

      <div>
        {lesson.audio_deleted ? (
          <p className="muted">O áudio foi apagado depois de 30 dias. O texto continua aqui.</p>
        ) : (
          <>
            {/* Player próprio: o do iPhone mostra 00:00 porque os arquivos gravados não trazem a duração. */}
            <audio
              ref={audio}
              onEnded={playNext}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setNow(lessonTime(content.chunks, playingIdx.current, e.currentTarget.currentTime))}
            />
            {content.chunks.length > 0 && (
              <div className="player">
                <button className="play" onClick={togglePlay} aria-label={playing ? 'Pausar áudio' : 'Tocar áudio'}>
                  <span className="swap">
                    <span data-shown={!playing}><Icon name="play" size={20} /></span>
                    <span data-shown={playing}><Icon name="pause" size={20} /></span>
                  </span>
                </button>
                <span className="player-time">{formatClock(now)}</span>
                <input
                  type="range"
                  aria-label="Posição do áudio"
                  min={0}
                  max={Math.max(1, Math.floor(total))}
                  step={1}
                  value={Math.floor(now)}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setNow(t);
                    playAt(t);
                  }}
                />
                <span className="player-time">{formatClock(total)}</span>
              </div>
            )}
          </>
        )}

        {(lesson.status === 'uploading' || lesson.status === 'processing') && (
          <PipelineStatus
            onDevice={onDevice}
            onServer={content.chunks.length}
            expected={lesson.expected_chunks}
            uploadError={problems.upload}
            processingError={problems.processing}
            onSendNow={() => void sendNow()}
            sending={sending}
          />
        )}

        {(lesson.status === 'ready' || lesson.status === 'processing') && lesson.error_message && (
          <p className="notice">{lesson.error_message}</p>
        )}
      </div>

      <nav className="segmented" role="tablist" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        <span className="thumb" style={{ width: `calc((100% - 6px) / ${tabs.length})`, transform: `translateX(${tabIndex * 100}%)` }} />
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" id={`tab-${key}`} aria-controls={`panel-${key}`} aria-selected={shownTab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {/* As abas ficam montadas: trocar de aba não perde o que está sendo editado. */}
      <Panel tab="summary" active={shownTab}>
        {content.summary ? (
          <EditableMarkdown text={content.summary} components={marked(query)} onSave={storeOutput('summary')} onDirty={markDirty.summary} />
        ) : (
          <p className="muted">{pendingText}</p>
        )}
      </Panel>
      <Panel tab="rewrite" active={shownTab}>
        {content.rewrite ? (
          <EditableMarkdown text={content.rewrite} components={marked(query)} onSave={storeOutput('rewrite')} onDirty={markDirty.rewrite} />
        ) : (
          <p className="muted">{pendingText}</p>
        )}
      </Panel>
      <Panel tab="transcript" active={shownTab}>
        {content.segments.length ? (
          <EditableList
            items={content.segments.filter((s) => s.id != null).map((s) => ({ key: s.id!, label: formatClock(s.start_s), text: s.text }))}
            onSave={storeSegments}
            onDirty={markDirty.transcript}
            view={
              <ol className="transcript">
                {content.segments.map((s, i) => {
                  const focused = focusAt != null && Math.abs(s.start_s - focusAt) < 0.01;
                  return (
                    <li key={s.id ?? i}>
                      <button
                        className="segment"
                        data-focus={focused}
                        ref={focused ? (el) => {
                          if (el && !scrolled.current) {
                            scrolled.current = true;
                            el.scrollIntoView({ block: 'center' });
                          }
                        } : undefined}
                        onClick={() => playAt(s.start_s)}
                        disabled={lesson.audio_deleted}
                      >
                        <span className="t">{formatClock(s.start_s)}</span>
                        <span><Highlight text={s.text} query={query} /></span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            }
          />
        ) : (
          <p className="muted">{pendingText}</p>
        )}
      </Panel>
      {!wide && (
        <Panel tab="notes" active={shownTab}>
          <Notes lessonId={lessonId} initial={lesson.notes ?? ''} />
        </Panel>
      )}
    </div>
  );

  if (!wide) return <section className="enter">{main}</section>;
  return (
    <section className="enter study-layout">
      <div className="study-main">{main}</div>
      <aside className="study-side" aria-label="Anotações e perguntas">
        <nav className="segmented side-tabs" role="tablist" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <span className="thumb" style={{ width: 'calc((100% - 6px) / 2)', transform: `translateX(${side === 'ask' ? 100 : 0}%)` }} />
          <button role="tab" aria-selected={side === 'notes'} onClick={() => setSide('notes')}>Anotações</button>
          <button role="tab" aria-selected={side === 'ask'} onClick={() => setSide('ask')} disabled={lesson.status !== 'ready'}>Perguntar</button>
        </nav>
        <div hidden={side !== 'notes'}>
          <Notes lessonId={lessonId} initial={lesson.notes ?? ''} />
        </div>
        <div hidden={side !== 'ask'}>
          {lesson.status === 'ready' && (
            <AskScreen embedded lessonIds={[lesson.id]} title={lesson.title} onBack={() => setSide('notes')} onOpenSource={(_id, t) => goTo(t)} />
          )}
        </div>
      </aside>
    </section>
  );
}

function Panel({ tab, active, children }: { tab: Tab; active: Tab; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} hidden={tab !== active} className="fade-in">
      {children}
    </div>
  );
}

/** Anotações da aula: salvam sozinhas. Montadas uma vez por aula, para não perder nada ao trocar de aba. */
function Notes({ lessonId, initial }: { lessonId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const save = useCallback((v: string) => saveNotes(lessonId, v), [lessonId]);
  const state = useAutosave(text, save);
  return <NotesEditor value={text} onChange={setText} state={state} />;
}

/** Destaca o termo buscado também no resumo e na reescrita. */
function marked(query: string) {
  if (!query.trim()) return undefined;
  const wrap = (Tag: 'p' | 'li' | 'strong') =>
    function Marked({ children }: { children?: React.ReactNode }) {
      return <Tag>{mapText(children, query)}</Tag>;
    };
  return { p: wrap('p'), li: wrap('li'), strong: wrap('strong') };
}

function mapText(node: React.ReactNode, query: string): React.ReactNode {
  if (typeof node === 'string') return <Highlight text={node} query={query} />;
  if (Array.isArray(node)) return node.map((n, i) => <Fragment key={i}>{mapText(n, query)}</Fragment>);
  return node;
}
