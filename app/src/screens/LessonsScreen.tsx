import { useCallback, useEffect, useState } from 'react';
import type { Lesson } from '../lib/types';
import { listLessons, requestProcessing } from '../lessons/api';
import { finalizeAbandoned } from '../lessons/recovery';
import { formatDuration, statusLabel } from '../lessons/format';

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

  // Enquanto o app está aberto, empurra o processamento das aulas pendentes.
  useEffect(() => {
    void refresh();
    const timer = setInterval(async () => {
      const pending = (lessons ?? []).filter((l) => l.status === 'uploading' || l.status === 'processing');
      for (const l of pending) {
        try {
          await requestProcessing(l.id);
        } catch {
          /* tenta de novo no próximo ciclo */
        }
      }
      if (pending.length) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [lessons, refresh]);

  const finalize = async (id: string) => {
    await finalizeAbandoned(id);
    void refresh();
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
            {l.status === 'recording' && (
              <button onClick={() => finalize(l.id)}>Finalizar gravação interrompida</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
