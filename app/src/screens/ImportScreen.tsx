import { useRef, useState, type FormEvent } from 'react';
import { createLesson, deleteLesson, finishRecording } from '../lessons/api';
import type { Lesson } from '../lib/types';
import { cleanName, createFolder } from '../lessons/folders';
import { pendingKeys, putChunk, removeChunk } from '../storage/localQueue';
import { uploadPending } from '../storage/uploader';
import { supabase } from '../lib/supabase';
import { prepareImport, UnsupportedMediaError, type Prepared } from '../media/importFile';
import { formatDuration } from '../lessons/format';
import SubjectPicker from '../components/SubjectPicker';
import Icon from '../components/Icon';

type Props = { folders: string[]; onDone: (lessonId: string) => void; onCancel: () => void };

type Phase =
  | { name: 'pick' }
  | { name: 'reading'; file: File }
  | { name: 'ready'; file: File; prepared: Prepared }
  | { name: 'saving'; file: File; prepared: Prepared; done: number };

/** Nome do arquivo sem extensão e sem os traços que o iPhone põe. */
export const titleFromFile = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Importa um áudio ou vídeo do aparelho como uma aula nova: depois segue o mesmo caminho da gravação. */
export default function ImportScreen({ folders, onDone, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const autoTitle = useRef('');

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPhase({ name: 'reading', file });
    // O título acompanha o arquivo, a não ser que a pessoa já tenha escrito outro.
    setTitle((t) => (!t || t === autoTitle.current ? (autoTitle.current = titleFromFile(file.name)) : t));
    try {
      const prepared = await prepareImport(file);
      setPhase({ name: 'ready', file, prepared });
    } catch (err) {
      setError(err instanceof UnsupportedMediaError ? err.message : 'Não consegui ler este arquivo. Tente outro formato (m4a, mp3 ou mp4).');
      setPhase({ name: 'pick' });
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (phase.name !== 'ready') return;
    const { file, prepared } = phase;
    setError(null);
    setPhase({ name: 'saving', file, prepared, done: 0 });
    let lesson: Lesson | null = null;
    try {
      const name = cleanName(subject);
      if (name) await createFolder(name).catch(() => {});
      // A data da aula é a do arquivo (quando foi gravado), não a de hoje.
      const recordedAt = file.lastModified ? new Date(file.lastModified) : undefined;
      lesson = await createLesson({ title: title.trim() || titleFromFile(file.name), subject: name, recordedAt });
      let done = 0;
      const id = lesson.id;
      for await (const c of prepared.chunks()) {
        await putChunk({ lessonId: id, idx: c.idx, blob: c.blob, startS: c.startS, durationS: c.durationS });
        done++;
        setPhase({ name: 'saving', file, prepared, done });
      }
      await finishRecording(lesson.id, Math.round(prepared.durationS), prepared.chunkCount);
      // Começa a enviar já; o envio continua sozinho em segundo plano.
      void supabase.auth.getUser().then(({ data }) => data.user && uploadPending(data.user.id));
      onDone(lesson.id);
    } catch {
      // Sem aula pela metade: apaga a aula criada e as partes já guardadas, para tentar de novo do zero.
      if (lesson) {
        const id = lesson.id;
        for (const k of await pendingKeys(id).catch(() => [])) await removeChunk(id, k.idx).catch(() => {});
        await deleteLesson(lesson).catch(() => {});
      }
      setError('Não deu para salvar a aula. Verifique a internet e o espaço do iPhone e tente de novo.');
      setPhase({ name: 'ready', file, prepared });
    }
  };

  const busy = phase.name === 'reading' || phase.name === 'saving';
  const file = phase.name === 'pick' ? null : phase.file;
  const prepared = phase.name === 'ready' || phase.name === 'saving' ? phase.prepared : null;

  return (
    <form onSubmit={save} className="enter">
      <button type="button" className="back" onClick={onCancel} aria-label="Voltar" disabled={phase.name === 'saving'}>
        <Icon name="back" size={20} />
        Aulas
      </button>
      <h1 className="title">Importar aula</h1>
      <p className="subtitle">Escolha um áudio ou vídeo do iPhone, de até 1h30. Do vídeo, só o som é usado.</p>

      <div>
        <input
          ref={input}
          type="file"
          accept="audio/*,video/*,.m4a,.mp3,.aac,.mp4,.mov"
          hidden
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <button type="button" className="file-pick" onClick={() => input.current?.click()} disabled={busy} data-filled={Boolean(file)}>
          <span className="file-icon"><Icon name={file ? 'check' : 'upload'} size={20} /></span>
          <span className="file-text">
            <strong>{file ? file.name : 'Escolher arquivo'}</strong>
            <small>
              {phase.name === 'reading'
                ? 'Lendo o arquivo…'
                : prepared
                  ? `${formatDuration(prepared.durationS)} de áudio, em ${prepared.chunkCount} ${prepared.chunkCount === 1 ? 'parte' : 'partes'}`
                  : 'm4a, mp3, aac, mp4 ou mov'}
            </small>
          </span>
        </button>
      </div>

      <div>
        <label htmlFor="import-title">Título da aula</label>
        <input id="import-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Derivadas e regra da cadeia" />
        <label htmlFor="import-subject">Matéria</label>
        <SubjectPicker id="import-subject" folders={folders} value={subject} onChange={setSubject} />
      </div>

      <div>
        {error && <p className="notice" role="alert">{error}</p>}
        {phase.name === 'saving' && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.prepared.chunkCount} aria-valuenow={phase.done}>
            <span style={{ width: `${(phase.done / phase.prepared.chunkCount) * 100}%` }} />
          </div>
        )}
        <div className="actions">
          <button className="primary grow" type="submit" disabled={phase.name !== 'ready'}>
            {phase.name === 'saving' ? `Preparando ${phase.done} de ${phase.prepared.chunkCount}…` : 'Importar e transcrever'}
          </button>
        </div>
      </div>
    </form>
  );
}
