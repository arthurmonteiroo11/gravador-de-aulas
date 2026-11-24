import { useState } from 'react';
import Sheet from './Sheet';
import { cleanNames, saveSpeakerNames, type SpeakerNames } from '../lessons/speakers';

type Props = { lessonId: string; labels: string[]; names: SpeakerNames; onClose: () => void; onSaved: (names: SpeakerNames) => void };

/** Dar nome a quem fala nesta aula ("Falante 1" vira "Ana"). Vale na transcrição e nas perguntas. */
export default function SpeakersSheet({ lessonId, labels, names, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<SpeakerNames>(names);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const clean = cleanNames(draft, labels);
    try {
      await saveSpeakerNames(lessonId, clean);
      onSaved(clean);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Quem fala" titleId="speakers-title" onClose={onClose}>
      <p className="muted hint sheet-lead">Troque os rótulos pelos nomes. Deixe em branco para manter o rótulo.</p>
      <div className="speaker-fields">
        {labels.map((l, i) => (
          <label key={l} className="speaker-field">
            <span>{l}</span>
            <input
              value={draft[l] ?? ''}
              placeholder={l}
              maxLength={40}
              autoFocus={i === 0}
              onChange={(e) => setDraft((d) => ({ ...d, [l]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="actions">
        <button className="ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="primary grow" onClick={() => void save()} disabled={busy}>{busy ? 'Salvando…' : 'Salvar nomes'}</button>
      </div>
    </Sheet>
  );
}
