import { Fragment, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { Lesson } from '../lib/types';
import { getLesson, requestProcessing } from '../lessons/api';
import { listPending } from '../storage/localQueue';
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
import type { CSSProperties } from 'react';

type Tab = 'summary' | 'rewrite' | 'transcript';
const TABS: Array<[Tab, string]> = [['summary', 'Resumo'], ['rewrite', 'Reescrita'], ['transcript', 'Transcrição']];

type Props = { lessonId: string; onBack: () => void; focus?: OpenFocus };

export default function LessonScreen({ lessonId, onBack, focus }: Props) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [content, setContent] = useState<LessonContent | null>(null);
  const [tab, setTab] = useState<Tab>(focus?.tab ?? 'summary');
  const query = focus?.query ?? '';
  const scrolled = useRef(false);
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
      const pending = await listPending(lessonId).catch(async (err) => {
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
    <button className="back" onClick={onBack} aria-label="Voltar">
      <Icon name="back" size={20} />
      Aulas
    </button>
  );
  if (!lesson || !content) return <section>{back}<p className="muted">Carregando…</p></section>;

  const pendingText = lesson.status === 'error' ? `Erro: ${lesson.error_message ?? 'tente de novo mais tarde.'}` : `${statusLabel(lesson)}…`;
  const total = lessonLength(content.chunks);
  const tabIndex = TABS.findIndex(([k]) => k === tab);

  return (
    <section className="enter">
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

      <nav className="segmented" role="tablist">
        <span className="thumb" style={{ transform: `translateX(${tabIndex * 100}%)` }} />
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <div key={tab} className="fade-in">
        {tab === 'summary' && (content.summary ? <div className="reading"><Markdown components={marked(query)}>{content.summary}</Markdown></div> : <p className="muted">{pendingText}</p>)}
        {tab === 'rewrite' && (content.rewrite ? <div className="reading"><Markdown components={marked(query)}>{content.rewrite}</Markdown></div> : <p className="muted">{pendingText}</p>)}
        {tab === 'transcript' &&
          (content.segments.length ? (
            <ol className="transcript">
              {content.segments.map((s, i) => {
                const focused = focus?.startS != null && Math.abs(s.start_s - focus.startS) < 0.01;
                return (
                  <li key={i}>
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
          ) : (
            <p className="muted">{pendingText}</p>
          ))}
      </div>
    </section>
  );
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
