import { useEffect, useRef, useState } from 'react';
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
import { formatClock, formatDuration, statusLabel } from '../lessons/format';

type Tab = 'summary' | 'rewrite' | 'transcript';
const TABS: Array<[Tab, string]> = [['summary', 'Resumo'], ['rewrite', 'Reescrita'], ['transcript', 'Transcrição']];

export default function LessonScreen({ lessonId, onBack }: { lessonId: string; onBack: () => void }) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [content, setContent] = useState<LessonContent | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
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

  if (!lesson || !content) return <p className="muted">Carregando…</p>;

  const pendingText = lesson.status === 'error' ? `Erro: ${lesson.error_message ?? 'tente de novo mais tarde.'}` : `${statusLabel(lesson)}…`;

  return (
    <section>
      <p><button onClick={onBack}>Voltar</button></p>
      <h2 style={{ margin: '8px 0' }}>{lesson.title}</h2>
      <p className="muted">
        {[lesson.subject, new Date(lesson.recorded_at).toLocaleDateString('pt-BR'), formatDuration(lesson.duration_s)].filter(Boolean).join(' · ')}
      </p>

      {lesson.audio_deleted ? (
        <p className="muted">Áudio apagado após 30 dias.</p>
      ) : (
        <p>
          {/* Player próprio: o do iPhone mostra 00:00 porque os arquivos gravados não trazem a duração. */}
          <audio
            ref={audio}
            onEnded={playNext}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setNow(lessonTime(content.chunks, playingIdx.current, e.currentTarget.currentTime))}
          />
          {content.chunks.length > 0 && (
            <span className="player">
              <button onClick={togglePlay} aria-label={playing ? 'Pausar áudio' : 'Tocar áudio'}>{playing ? '❚❚' : '▶'}</button>
              <span className="player-time">{formatClock(now)}</span>
              <input
                type="range"
                aria-label="Posição do áudio"
                min={0}
                max={Math.max(1, Math.floor(lessonLength(content.chunks)))}
                step={1}
                value={Math.floor(now)}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setNow(t);
                  playAt(t);
                }}
              />
              <span className="player-time">{formatClock(lessonLength(content.chunks))}</span>
            </span>
          )}
        </p>
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

      <nav className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'summary' && (content.summary ? <Markdown>{content.summary}</Markdown> : <p className="muted">{pendingText}</p>)}
      {tab === 'rewrite' && (content.rewrite ? <Markdown>{content.rewrite}</Markdown> : <p className="muted">{pendingText}</p>)}
      {tab === 'transcript' &&
        (content.segments.length ? (
          <ol className="transcript">
            {content.segments.map((s, i) => (
              <li key={i}>
                <button className="segment" onClick={() => playAt(s.start_s)} disabled={lesson.audio_deleted}>
                  <span className="muted">[{formatClock(s.start_s)}]</span> {s.text}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{pendingText}</p>
        ))}
    </section>
  );
}
