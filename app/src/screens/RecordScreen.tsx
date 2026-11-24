import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChunkRecorder, type RecordedChunk } from '../recording/chunkRecorder';
import { getVoiceStream, releaseVoiceStream } from '../recording/voiceFilter';
import { keepScreenOn } from '../recording/wakeLock';
import { watchLifecycle } from '../recording/lifecycle';
import { putChunk } from '../storage/localQueue';
import { createLesson, finishRecording } from '../lessons/api';
import { formatClock } from '../lessons/format';

export const LIMIT_S = 5400; // 1h30

type RecorderLike = {
  state: string;
  recordedS: number;
  chunkCount: number;
  start(): void;
  pause(): Promise<void>;
  resume(stream: MediaStream): void;
  stop(): Promise<void>;
};

export type RecordDeps = {
  getVoiceStream: (opts: { voiceFilter: boolean }) => Promise<MediaStream>;
  releaseVoiceStream: (s: MediaStream) => void;
  createLesson: (input: { title: string; subject?: string }) => Promise<{ id: string }>;
  finishRecording: (lessonId: string, durationS: number, chunkCount: number) => Promise<void>;
  keepScreenOn: (onUnavailable?: () => void) => Promise<() => Promise<void>>;
  createRecorder: (stream: MediaStream, onChunk: (c: RecordedChunk) => void) => RecorderLike;
  saveChunk: (c: RecordedChunk & { lessonId: string }) => Promise<void>;
};

const realDeps: RecordDeps = {
  getVoiceStream,
  releaseVoiceStream,
  createLesson,
  finishRecording,
  keepScreenOn,
  createRecorder: (stream, onChunk) => new ChunkRecorder(stream, onChunk),
  saveChunk: putChunk,
};

const micErrorMessage = (e: unknown) =>
  (e as { name?: string })?.name === 'NotAllowedError'
    ? 'Permita o microfone em Ajustes > Safari > Microfone e tente de novo.'
    : 'Não foi possível acessar o microfone.';

type Props = { deps?: RecordDeps; onDone: (lessonId: string) => void; onCancel: () => void };

export default function RecordScreen({ deps = realDeps, onDone, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [voiceFilter, setVoiceFilter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'starting' | 'recording' | 'paused' | 'limit' | 'finishing'>('form');
  const [seconds, setSeconds] = useState(0);
  const [screenWarning, setScreenWarning] = useState(false);

  const rec = useRef<RecorderLike | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const lessonId = useRef<string | null>(null);
  const askedLimit = useRef(false);
  const cleanups = useRef<Array<() => unknown>>([]);

  useEffect(() => () => cleanups.current.forEach((fn) => void fn()), []);

  // Atualiza o relógio e percebe pausas vindas do sistema (tela bloqueada, ligação).
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const timer = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      setSeconds(r.recordedS);
      if (r.state === 'paused' && phase === 'recording') setPhase('paused');
      if (r.state === 'recording' && r.recordedS >= LIMIT_S && !askedLimit.current) {
        askedLimit.current = true;
        void r.pause().then(() => setPhase('limit'));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, deps]);

  const releaseStream = () => {
    if (stream.current) deps.releaseVoiceStream(stream.current);
    stream.current = null;
  };

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPhase('starting');
    try {
      stream.current = await deps.getVoiceStream({ voiceFilter });
    } catch (e) {
      setError(micErrorMessage(e));
      setPhase('form');
      return;
    }
    try {
      const lesson = await deps.createLesson({ title: title.trim(), subject: subject.trim() || undefined });
      lessonId.current = lesson.id;
      const id = lesson.id;
      const r = deps.createRecorder(stream.current, (c) => {
        deps.saveChunk({ lessonId: id, ...c }).catch(() =>
          setError('Não consegui salvar parte da gravação no aparelho. Libere espaço no iPhone e continue.'),
        );
      });
      rec.current = r;
      r.start();
      cleanups.current.push(await deps.keepScreenOn(() => setScreenWarning(true)), watchLifecycle(r));
      setPhase('recording');
    } catch {
      releaseStream();
      setError('Não foi possível criar a aula. Verifique a internet e tente de novo.');
      setPhase('form');
    }
  };

  const pause = async () => {
    await rec.current?.pause();
    releaseStream();
    setPhase('paused');
  };

  const resume = async () => {
    setError(null);
    try {
      releaseStream();
      stream.current = await deps.getVoiceStream({ voiceFilter });
      rec.current?.resume(stream.current);
      setPhase('recording');
    } catch (e) {
      setError(micErrorMessage(e));
    }
  };

  const finish = async () => {
    const r = rec.current;
    const id = lessonId.current;
    if (!r || !id) return;
    setPhase('finishing');
    await r.stop();
    releaseStream();
    cleanups.current.forEach((fn) => void fn());
    cleanups.current = [];
    try {
      await deps.finishRecording(id, r.recordedS, r.chunkCount);
    } catch {
      // A gravação já está salva no aparelho; o status é corrigido no próximo envio.
    }
    onDone(id);
  };

  if (phase === 'form' || phase === 'starting') {
    return (
      <form onSubmit={start}>
        <label htmlFor="title">Título da aula</label>
        <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="subject">Matéria (opcional)</label>
        <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'inherit' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={voiceFilter} onChange={(e) => setVoiceFilter(e.target.checked)} />
          Filtro de voz
        </label>
        {error && <p className="notice">{error}</p>}
        <p style={{ display: 'flex', gap: 8 }}>
          <button className="primary" type="submit" disabled={phase === 'starting'}>Gravar</button>
          <button type="button" onClick={onCancel}>Voltar</button>
        </p>
      </form>
    );
  }

  return (
    <section>
      <p className="clock" aria-live="off">{formatClock(seconds)}</p>
      <p className="notice">Não bloqueie a tela nem troque de app. Se acontecer, a gravação pausa.</p>
      {screenWarning && (
        <p className="notice">
          Este iPhone não deixou o app manter a tela acesa. Em Ajustes &gt; Tela e Brilho &gt; Bloqueio Automático, escolha Nunca durante a aula.
        </p>
      )}
      {phase === 'paused' && <p className="notice">Gravação pausada — toque em Continuar para seguir na mesma aula.</p>}
      {phase === 'limit' && (
        <div className="notice" role="alertdialog">
          <p>Já são 1h30. Encerrar a gravação?</p>
          <p style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={finish}>Encerrar</button>
            <button onClick={resume}>Continuar gravando</button>
          </p>
        </div>
      )}
      {error && <p className="notice">{error}</p>}
      {phase !== 'limit' && (
        <p style={{ display: 'flex', gap: 8 }}>
          {phase === 'recording' && <button onClick={pause}>Pausar</button>}
          {phase === 'paused' && <button className="primary" onClick={resume}>Continuar</button>}
          <button onClick={finish} disabled={phase === 'finishing'}>Encerrar</button>
        </p>
      )}
    </section>
  );
}
