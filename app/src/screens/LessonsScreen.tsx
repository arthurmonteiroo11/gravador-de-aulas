import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lesson } from '../lib/types';
import { listLessons, requestProcessing } from '../lessons/api';
import { finalizeAbandoned } from '../lessons/recovery';
import { formatDuration, statusLabel } from '../lessons/format';
import { startPoller } from '../lessons/poller';
import { retryLesson } from '../lessons/retry';

type Props = { onRecord: () => void; onOpen: (id: string) => void };

const POLL_MS = 10_000;

export default function LessonsScreen({ onRecord, onOpen }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLessons(await listLessons());
      setError(null);
    } catch {
      setError('Sem conexão. Mostrando quando a internet voltar.');
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
        } catch {
          /* tenta de novo no próximo ciclo */
        }
      }
      if (pending.length) await refresh();
    }, POLL_MS);
  }, [refresh]);

  const finalize = async (id: string) => {
    try {
      await finalizeAbandoned(id);
      void refresh();
    } catch {
      setError('Não foi possível finalizar. Verifique a internet e tente de novo.');
    }
  };

  return (
    <section>
      <p><button className="primary" onClick={onRecord}>Nova gravação</button></p>
      {error && <p className="notice">{error}</p>}
      {lessons === null && <p className="muted">Carregando…</p>}
      {lessons?.length === 0 && <p className="muted">Nenhuma aula ainda.</p>}
      <ul className="lesson-list">
        {lessons?.map((l) => (
          <li key={l.id}>
            <button className="lesson-row" onClick={() => onOpen(l.id)}>
              <strong>{l.title}</strong>
              <span className="muted">
                {[l.subject, new Date(l.recorded_at).toLocaleDateString('pt-BR'), formatDuration(l.duration_s), statusLabel(l)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {l.status === 'error' && (
              <button onClick={() => void retryLesson(l).then(refresh).catch(() => setError('Não foi possível tentar de novo.'))}>
                Tentar de novo
              </button>
            )}
            {l.status === 'recording' && (
              <button onClick={() => finalize(l.id)}>Finalizar gravação interrompida</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
