import { useEffect, useState } from 'react';
import type { AudioChunk, Lesson } from '../lib/types';
import { cardCount, createFlashcards } from '../lessons/flashcards';
import { deleteLesson, updateLesson } from '../lessons/api';
import { cleanName, createFolder } from '../lessons/folders';
import { pendingKeys, removeChunk } from '../storage/localQueue';
import { fileName, joinAudio, shareFile } from '../media/exportAudio';
import SubjectPicker from './SubjectPicker';
import Icon from './Icon';
import Sheet from './Sheet';

type Props = {
  lesson: Lesson;
  chunks: AudioChunk[];
  urls: Map<number, string>;
  folders: string[];
  onReview: () => void;
  onPrint: () => void;
  onAsk: () => void;
  onChanged: (patch: Partial<Lesson>) => void;
  onDeleted: () => void;
};

/** Os atalhos de estudo de uma aula: flashcards, perguntar, PDF, áudio e editar. */
export default function LessonActions({ lesson, chunks, urls, folders, onReview, onPrint, onAsk, onChanged, onDeleted }: Props) {
  const [cards, setCards] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | 'cards' | 'audio'>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ready = lesson.status === 'ready';

  useEffect(() => {
    if (ready) cardCount(lesson.id).then(setCards).catch(() => setCards(0));
  }, [lesson.id, ready]);

  const flashcards = async () => {
    if (cards) return onReview();
    setBusy('cards');
    setError(null);
    try {
      setCards(await createFlashcards(lesson.id));
      onReview();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const audio = async () => {
    setBusy('audio');
    setError(null);
    try {
      const parts = chunks.filter((c) => urls.has(c.idx)).map((c) => ({ url: urls.get(c.idx)!, mime: c.mime_type ?? 'audio/mp4' }));
      if (!parts.length) throw new Error('O áudio desta aula ainda não chegou ao servidor.');
      const { bytes, ext, mime } = await joinAudio(parts);
      await shareFile(new File([bytes], fileName(lesson.title, ext), { type: mime }));
    } catch (err) {
      setError((err as Error).message || 'Não deu para exportar o áudio.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="lesson-actions" role="group" aria-label="Ações da aula">
        <button className="pill" onClick={() => void flashcards()} disabled={!ready || busy !== null}>
          <Icon name="cards" size={18} />
          {busy === 'cards' ? 'Criando…' : cards ? `Flashcards (${cards})` : 'Flashcards'}
        </button>
        <button className="pill" onClick={onAsk} disabled={!ready}>
          <Icon name="chat" size={18} />
          Perguntar
        </button>
        <button className="pill" onClick={onPrint} disabled={!ready}>
          <Icon name="doc" size={18} />
          PDF
        </button>
        {!lesson.audio_deleted && (
          <button className="pill" onClick={() => void audio()} disabled={busy !== null || !chunks.length}>
            <Icon name="download" size={18} />
            {busy === 'audio' ? 'Juntando…' : 'Áudio'}
          </button>
        )}
        <button className="pill" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} />
          Editar
        </button>
      </div>
      {busy === 'cards' && <p className="muted hint">O Gemini está lendo a aula e montando as perguntas. Leva uns segundos.</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {editing && (
        <EditLessonSheet
          lesson={lesson}
          folders={folders}
          onClose={() => setEditing(false)}
          onSaved={(patch) => {
            onChanged(patch);
            setEditing(false);
          }}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}

/** Folha que sobe de baixo: título, matéria e apagar a aula. */
function EditLessonSheet({ lesson, folders, onClose, onSaved, onDeleted }: {
  lesson: Lesson;
  folders: string[];
  onClose: () => void;
  onSaved: (patch: Partial<Lesson>) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [subject, setSubject] = useState(lesson.subject ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const save = async () => {
    const patch = { title: title.trim() || lesson.title, subject: cleanName(subject) || null };
    setBusy(true);
    setError(null);
    try {
      if (patch.subject) await createFolder(patch.subject).catch(() => {});
      await updateLesson(lesson.id, patch);
      onSaved(patch);
    } catch {
      setError('Não salvou. Verifique a internet.');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    setError(null);
    try {
      await deleteLesson(lesson);
      // Partes que ainda estavam só no aparelho também saem.
      for (const c of await pendingKeys(lesson.id).catch(() => [])) await removeChunk(lesson.id, c.idx).catch(() => {});
      onDeleted();
    } catch {
      setError('Não deu para apagar. Verifique a internet.');
      setBusy(false);
    }
  };

  return (
    <Sheet title="Editar aula" titleId="edit-lesson-title" onClose={onClose}>
      <label htmlFor="edit-title">Título</label>
      <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      <label htmlFor="edit-subject">Matéria</label>
      <SubjectPicker id="edit-subject" folders={folders} value={subject} onChange={setSubject} />
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="actions">
        <button className="ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="primary grow" onClick={() => void save()} disabled={busy}>Salvar</button>
      </div>
      <div className="sheet-danger">
        <button className="danger-outline" onClick={() => void remove()} disabled={busy} aria-live="polite">
          <Icon name="trash" size={18} />
          {confirmDelete ? 'Toque de novo para apagar de vez' : 'Apagar aula'}
        </button>
        <p className="muted hint">Apaga o áudio, o texto, as anotações e os flashcards desta aula.</p>
      </div>
    </Sheet>
  );
}
