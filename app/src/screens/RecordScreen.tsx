import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChunkRecorder, type RecordedChunk } from '../recording/chunkRecorder';
import { getVoiceStream, releaseVoiceStream } from '../recording/voiceFilter';
import { keepScreenOn } from '../recording/wakeLock';
import { watchLifecycle } from '../recording/lifecycle';
import { putChunk } from '../storage/localQueue';
import { createLesson, finishRecording } from '../lessons/api';
import { formatClock } from '../lessons/format';
import { serverErrorDetail } from '../lessons/errors';
import { appUpdater } from '../lib/appUpdate';
import Icon from '../components/Icon';

export const LIMIT_S = 5400; // 1h30

const SYSTEM_PAUSE: Record<string, string> = {
  ended: 'O iPhone desligou o microfone. ',
  mute: 'O iPhone silenciou o microfone. ',
  'recorder-stopped': 'O iPhone parou o gravador. ',
};
const pausedBySystem = (reason: string | null | undefined) => (reason ? SYSTEM_PAUSE[reason] ?? '' : '');

type RecorderLike = {
  state: string;
  recordedS: number;
  chunkCount: number;
  pauseReason?: string | null;
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

type Props = { deps?: RecordDeps; onDone: (lessonId: string) => void; onCancel: () => void; subjects?: string[] };

export default function RecordScreen({ deps = realDeps, onDone, onCancel, subjects = [] }: Props) {
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
  const saves = useRef<Array<Promise<void>>>([]);
  const resuming = useRef(false);

  useEffect(() => () => cleanups.current.forEach((fn) => void fn()), []);

  // Atualização do app fica para depois enquanto esta tela está aberta.
  useEffect(() => {
    appUpdater.setRecording(true);
    return () => appUpdater.setRecording(false);
  }, []);

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
    let id: string;
    try {
      const lesson = await deps.createLesson({ title: title.trim(), subject: subject.trim() || undefined });
      lessonId.current = lesson.id;
      id = lesson.id;
    } catch (err) {
      releaseStream();
      const detail = serverErrorDetail(err);
      setError(
        detail
          ? `Não foi possível criar a aula. Erro do servidor: ${detail}`
          : 'Não foi possível criar a aula. Verifique a internet e tente de novo.',
      );
      setPhase('form');
      return;
    }
    try {
      const r = deps.createRecorder(stream.current, (c) => {
        saves.current.push(
          deps.saveChunk({ lessonId: id, ...c }).catch(() =>
            setError('Não consegui salvar parte da gravação no aparelho. Libere espaço no iPhone e continue.'),
          ),
        );
      });
      rec.current = r;
      r.start();
      cleanups.current.push(await deps.keepScreenOn(() => setScreenWarning(true)), watchLifecycle(r));
      setPhase('recording');
    } catch (err) {
      releaseStream();
      const reason = err instanceof Error ? err.message : String(err);
      setError(`Não foi possível iniciar a gravação: ${reason}`);
      setPhase('form');
    }
  };

  const pause = async () => {
    await rec.current?.pause();
    releaseStream();
    setPhase('paused');
  };

  // Um toque duplo abriria dois microfones; no iPhone o segundo derruba o primeiro e a gravação pausa sozinha.
  const resume = async () => {
    if (resuming.current) return;
    resuming.current = true;
    setError(null);
    try {
      releaseStream();
      stream.current = await deps.getVoiceStream({ voiceFilter });
      rec.current?.resume(stream.current);
      setPhase('recording');
    } catch (e) {
      setError(micErrorMessage(e));
    } finally {
      resuming.current = false;
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
    // A última parte precisa estar no aparelho antes de dizer ao servidor quantas partes esperar.
    await Promise.all(saves.current);
    try {
      await deps.finishRecording(id, r.recordedS, r.chunkCount);
    } catch {
      // A gravação já está salva no aparelho; o status é corrigido no próximo envio.
    }
    onDone(id);
  };

  if (phase === 'form' || phase === 'starting') {
    return (
      <form onSubmit={start} className="enter">
        <button type="button" className="back" onClick={onCancel} aria-label="Voltar">
          <Icon name="back" size={20} />
          Aulas
        </button>
        <h1 className="title">Nova aula</h1>
        <div>
          <label htmlFor="title">Título da aula</label>
          <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Derivadas e regra da cadeia" />
          <label htmlFor="subject">Matéria (opcional)</label>
          <input id="subject" list="subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Cálculo I" autoComplete="off" />
          <datalist id="subjects">
            {subjects.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <label className="switch">
          <span>
            Filtro de voz
            <small>Reduz ruído e eco para destacar o professor.</small>
          </span>
          <input type="checkbox" checked={voiceFilter} onChange={(e) => setVoiceFilter(e.target.checked)} />
        </label>
        <div>
          {error && <p className="notice">{error}</p>}
          <div className="actions">
            <button className="danger grow" type="submit" disabled={phase === 'starting'}>
              Gravar
            </button>
          </div>
        </div>
      </form>
    );
  }

  const live = phase === 'recording';
  return (
    <section className="recorder enter">
      <span className="rec-state" data-on={live}>
        <span className="live" />
        {live ? 'Gravando' : phase === 'finishing' ? 'Salvando' : 'Pausada'}
      </span>
      <p className="clock" aria-live="off">{formatClock(seconds)}</p>
      <p className="rec-title">{title}</p>

      {phase !== 'limit' && (
        <div className="actions">
          {live && (
            <button className="big-button" data-on="true" onClick={pause} aria-label="Pausar">
              <Icon name="pause" size={34} />
            </button>
          )}
          {phase === 'paused' && (
            <button className="big-button" onClick={resume} aria-label="Continuar">
              <Icon name="mic" size={34} />
            </button>
          )}
          <button className="big-button calm" onClick={finish} disabled={phase === 'finishing'} aria-label="Encerrar">
            <Icon name="stop" size={28} />
          </button>
        </div>
      )}

      <div style={{ width: '100%', marginTop: 28 }}>
        {phase === 'paused' && (
          <p className="notice">
            {pausedBySystem(rec.current?.pauseReason)}Gravação pausada. Toque em Continuar para seguir na mesma aula.
          </p>
        )}
        {phase === 'limit' && (
          <div className="notice" role="alertdialog">
            <p style={{ marginTop: 0 }}>Já são 1h30. Encerrar a gravação?</p>
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="primary" onClick={finish}>Encerrar</button>
              <button onClick={resume}>Continuar gravando</button>
            </div>
          </div>
        )}
        {screenWarning && (
          <p className="notice">
            Este iPhone não deixou o app manter a tela acesa. Em Ajustes &gt; Tela e Brilho &gt; Bloqueio Automático, escolha Nunca durante a aula.
          </p>
        )}
        {error && <p className="notice">{error}</p>}
        <p className="muted" style={{ fontSize: '0.88rem' }}>Não bloqueie a tela nem troque de app. Se acontecer, a gravação pausa.</p>
      </div>
    </section>
  );
}
