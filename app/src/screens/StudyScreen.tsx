import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Lesson } from '../lib/types';
import { listLessons } from '../lessons/api';
import { deleteStudyNote, getStudyNote, saveStudyNote, type StudyNote } from '../lessons/study';
import { formatDay } from '../lessons/format';
import { subjectTone } from '../lessons/subjectTone';
import { EditableMarkdown } from '../components/Editable';
import Icon from '../components/Icon';

type Props = { id: string; onBack: () => void; onOpenLesson: (id: string) => void };

/** Um resumo que junta várias aulas. */
export default function StudyScreen({ id, onBack, onOpenLesson }: Props) {
  const [note, setNote] = useState<StudyNote | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(false);
  const markDirty = useRef((d: boolean) => void (dirty.current = d)).current;

  // O "toque de novo para apagar" volta ao normal sozinho depois de alguns segundos.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  useEffect(() => {
    getStudyNote(id).then(setNote).catch(() => setError('Não deu para abrir o resumo. Verifique a internet.'));
    listLessons().then(setLessons).catch(() => {});
  }, [id]);

  const back = (
    <button
      className="back"
      onClick={() => (!dirty.current || window.confirm('Você tem alterações não salvas. Sair mesmo assim?')) && onBack()}
      aria-label="Voltar"
    >
      <Icon name="back" size={20} />
      Aulas
    </button>
  );
  if (!note) return <section>{back}<p className={error ? 'notice' : 'muted'}>{error ?? 'Carregando…'}</p></section>;

  const byId = new Map(lessons.map((l) => [l.id, l]));
  const sources = note.lesson_ids.map((lid) => byId.get(lid)).filter((l): l is Lesson => Boolean(l));

  const remove = async () => {
    if (!confirming) return setConfirming(true);
    try {
      await deleteStudyNote(note.id);
      onBack();
    } catch {
      setError('Não deu para apagar. Verifique a internet.');
    }
  };

  return (
    <section className="enter">
      {back}
      <h1 className="title">{note.title}</h1>
      <p className="meta-line">
        <span className="stack"><Icon name="stack" size={15} />Junta {note.lesson_ids.length} aulas</span>
        <span>Criado {formatDay(note.created_at).toLowerCase().replace(/^(\d)/, 'em $1')}</span>
      </p>
      <div className="sources">
        {sources.map((l) => (
          <button key={l.id} onClick={() => onOpenLesson(l.id)} style={{ '--tone': subjectTone(l.subject) } as CSSProperties}>
            <span className="dot" />
            {l.title}, {formatDay(l.recorded_at).toLowerCase()}
          </button>
        ))}
      </div>
      <div>
        {error && <p className="notice">{error}</p>}
        <EditableMarkdown
          text={note.content_md}
          onDirty={markDirty}
          onSave={async (md) => {
            await saveStudyNote(note.id, { content_md: md });
            setNote({ ...note, content_md: md });
          }}
        />
      </div>
      <div className="actions">
        <button className="ghost danger-text" onClick={() => void remove()} aria-live="polite">
          {confirming ? 'Toque de novo para apagar' : 'Apagar este resumo'}
        </button>
      </div>
    </section>
  );
}
