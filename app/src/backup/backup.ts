import { supabase } from '../lib/supabase';
import { allPages } from '../lessons/content';
import { chunkPath } from '../storage/uploader';
import { makeZip, openZip, ZipError, type ZipEntry } from './zip';

// Backup de tudo da conta num .zip: backup.json com os textos e, se pedir, o áudio de cada aula.

export const BACKUP_APP = 'gravador-de-aulas';
export const BACKUP_VERSION = 1;
const JSON_NAME = 'backup.json';
// Gravação do iPhone: cerca de meio mega por minuto.
const MB_PER_MINUTE = 0.5;

type Seg = { block_idx: number; start_s: number; end_s: number; text: string; speaker: string | null };
type Output = { kind: 'rewrite' | 'summary'; content_md: string; model: string; created_at?: string };
type Card = { front: string; back: string; box: number; due_at: string; reviewed_at: string | null; created_at?: string };
type AudioRef = { idx: number; start_s: number; duration_s: number; mime_type: string; file: string };

export type BackupLesson = {
  id: string;
  title: string;
  subject: string | null;
  recorded_at: string;
  duration_s: number;
  status: string;
  notes: string;
  error_message: string | null;
  total_blocks: number | null;
  processed_blocks: number;
  speaker_names?: Record<string, string> | null;
  segments: Seg[];
  outputs: Output[];
  flashcards: Card[];
  audio: AudioRef[];
};

export type Backup = {
  app: typeof BACKUP_APP;
  version: number;
  exported_at: string;
  with_audio: boolean;
  subjects: { name: string; terms: string }[];
  lessons: BackupLesson[];
  study_notes: { title: string; lesson_ids: string[]; content_md: string; model: string | null; created_at: string }[];
};

export type Progress = (done: number, total: number, label: string) => void;

type LessonRow = Omit<BackupLesson, 'segments' | 'outputs' | 'flashcards' | 'audio'> & { audio_deleted: boolean };

const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const audioEstimateMb = (lessons: { duration_s: number; audio_deleted: boolean }[]) =>
  Math.ceil((lessons.filter((l) => !l.audio_deleted).reduce((s, l) => s + l.duration_s, 0) / 60) * MB_PER_MINUTE);

export const backupName = (d = new Date()) =>
  `aulas-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;

const extOf = (path: string) => path.split('.').pop() ?? 'm4a';

export async function listBackupLessons(): Promise<LessonRow[]> {
  return allPages<LessonRow>((from, to) =>
    supabase.from('lessons')
      .select('id, title, subject, recorded_at, duration_s, status, notes, error_message, total_blocks, processed_blocks, speaker_names, audio_deleted')
      .order('recorded_at').order('id').range(from, to),
  );
}

/** Junta tudo da conta. O áudio é baixado parte por parte e entra no .zip como veio. */
export async function exportBackup(withAudio: boolean, onProgress: Progress = () => {}): Promise<File> {
  onProgress(0, 1, 'Lendo as aulas');
  const [lessons, subjects, outputs, cards, notes, chunks] = await Promise.all([
    listBackupLessons(),
    supabase.from('subjects').select('name, terms').order('name').then(must),
    allPages<Output & { lesson_id: string }>((f, t) => supabase.from('lesson_outputs').select('lesson_id, kind, content_md, model, created_at').order('lesson_id').order('kind').range(f, t)),
    allPages<Card & { lesson_id: string }>((f, t) => supabase.from('flashcards').select('lesson_id, front, back, box, due_at, reviewed_at, created_at').order('created_at').order('id').range(f, t)),
    supabase.from('study_notes').select('title, lesson_ids, content_md, model, created_at').order('created_at').then(must),
    withAudio
      ? allPages<{ lesson_id: string; idx: number; start_s: number; duration_s: number; mime_type: string; path: string }>((f, t) =>
        supabase.from('audio_chunks').select('lesson_id, idx, start_s, duration_s, mime_type, path').order('lesson_id').order('idx').range(f, t))
      : Promise.resolve([]),
  ]);

  const audioFiles: ZipEntry[] = [];
  const out: BackupLesson[] = [];
  const total = lessons.length + chunks.length;
  let done = 0;
  for (const l of lessons) {
    onProgress(done, total, `Texto de "${l.title}"`);
    const segments = await allPages<Seg>((f, t) =>
      supabase.from('transcript_segments').select('block_idx, start_s, end_s, text, speaker').eq('lesson_id', l.id).order('start_s').order('id').range(f, t));
    const audio: AudioRef[] = [];
    for (const c of l.audio_deleted ? [] : chunks.filter((c) => c.lesson_id === l.id)) {
      onProgress(++done, total, `Áudio de "${l.title}" (parte ${c.idx + 1})`);
      const { data, error } = await supabase.storage.from('audio').download(c.path);
      if (error || !data) continue; // arquivo que já saiu do servidor: o texto segue no backup
      const file = `audio/${l.id}/${c.idx}.${extOf(c.path)}`;
      audioFiles.push({ name: file, data: new Uint8Array(await data.arrayBuffer()) });
      audio.push({ idx: c.idx, start_s: c.start_s, duration_s: c.duration_s, mime_type: c.mime_type, file });
    }
    const { audio_deleted: _gone, ...rest } = l;
    out.push({
      ...rest,
      notes: l.notes ?? '',
      segments,
      outputs: outputs.filter((o) => o.lesson_id === l.id).map(({ lesson_id: _l, ...o }) => o),
      flashcards: cards.filter((c) => c.lesson_id === l.id).map(({ lesson_id: _l, ...c }) => c),
      audio,
    });
    done++;
  }
  const backup: Backup = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    with_audio: withAudio,
    subjects: (subjects ?? []) as Backup['subjects'],
    lessons: out,
    study_notes: (notes ?? []) as Backup['study_notes'],
  };
  onProgress(total, total, 'Montando o arquivo');
  const json = new TextEncoder().encode(JSON.stringify(backup));
  return new File([makeZip([{ name: JSON_NAME, data: json }, ...audioFiles])], backupName(), { type: 'application/zip' });
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ZipError('O backup está danificado.');
  }
  const b = data as Partial<Backup>;
  if (b?.app !== BACKUP_APP || !Array.isArray(b.lessons)) throw new ZipError('Este arquivo não é um backup do app.');
  if ((b.version ?? 0) > BACKUP_VERSION) throw new ZipError('Este backup é de uma versão mais nova do app. Atualize o app e tente de novo.');
  return { subjects: [], study_notes: [], with_audio: false, ...b } as Backup;
}

const sameMoment = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/** Aulas que já estão na conta (mesmo título e mesma data) ficam de fora: restaurar duas vezes não duplica. */
export function planImport(backup: Backup, existing: { title: string; recorded_at: string }[]) {
  const add: BackupLesson[] = [];
  let skipped = 0;
  for (const l of backup.lessons) {
    if (existing.some((e) => e.title === l.title && sameMoment(e.recorded_at, l.recorded_at))) skipped++;
    else add.push(l);
  }
  return { add, skipped };
}

/** Aula que estava no meio do processamento volta como erro: o botão de tentar de novo resolve se o áudio veio junto. */
export function lessonRow(l: BackupLesson, id: string, withAudio: boolean, now = new Date()) {
  const finished = l.status === 'ready' || l.status === 'error';
  return {
    id,
    title: l.title,
    subject: l.subject,
    recorded_at: l.recorded_at,
    duration_s: l.duration_s,
    notes: l.notes ?? '',
    status: finished ? l.status : 'error',
    error_message: finished ? l.error_message : 'Veio de um backup antes de terminar de processar.',
    total_blocks: l.total_blocks,
    processed_blocks: l.processed_blocks,
    speaker_names: l.speaker_names ?? {},
    audio_deleted: !withAudio,
    audio_expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
  };
}

/** Resumos combinados voltam só se pelo menos uma das aulas deles entrou agora. */
export function mapStudyNotes(notes: Backup['study_notes'], idMap: Map<string, string>) {
  return notes
    .filter((n) => n.lesson_ids.some((id) => idMap.has(id)))
    .map((n) => ({ title: n.title, content_md: n.content_md, model: n.model, created_at: n.created_at, lesson_ids: n.lesson_ids.flatMap((id) => idMap.get(id) ?? []) }));
}

export type ImportResult = { added: number; skipped: number; failed: string[] };

async function inBatches<T>(rows: T[], size: number, write: (batch: T[]) => PromiseLike<{ error: unknown }>) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await write(rows.slice(i, i + size));
    if (error) throw error;
  }
}

/** Devolve as aulas do backup para a conta atual. Cada aula entra inteira ou não entra. */
export async function importBackup(file: Blob, onProgress: Progress = () => {}): Promise<ImportResult> {
  const zip = await openZip(file);
  const backup = parseBackup(new TextDecoder().decode(await zip.read(JSON_NAME)));
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Entre na sua conta antes de restaurar.');

  const existing = await listBackupLessons();
  const { add, skipped } = planImport(backup, existing);

  if (backup.subjects.length) {
    const { error } = await supabase.from('subjects')
      .upsert(backup.subjects.map((s) => ({ name: s.name, terms: s.terms ?? '' })), { onConflict: 'user_id,name', ignoreDuplicates: true });
    if (error) throw error;
  }

  const idMap = new Map<string, string>();
  const failed: string[] = [];
  for (let i = 0; i < add.length; i++) {
    const l = add[i];
    onProgress(i, add.length, `Restaurando "${l.title}"`);
    const id = crypto.randomUUID();
    const audio = l.audio.filter((a) => zip.names.includes(a.file));
    const uploaded: string[] = [];
    try {
      must(await supabase.from('lessons').insert(lessonRow(l, id, audio.length > 0)));
      await inBatches(l.segments, 500, (b) => supabase.from('transcript_segments').insert(b.map((s) => ({ ...s, lesson_id: id }))));
      if (l.outputs.length) must(await supabase.from('lesson_outputs').insert(l.outputs.map((o) => ({ ...o, lesson_id: id }))));
      for (const a of audio) {
        const path = chunkPath(userId, id, a.idx, a.mime_type);
        const up = await supabase.storage.from('audio').upload(path, new Blob([await zip.read(a.file)], { type: a.mime_type }), { contentType: a.mime_type });
        if (up.error) throw up.error;
        uploaded.push(path);
        must(await supabase.from('audio_chunks').insert({ lesson_id: id, idx: a.idx, start_s: a.start_s, duration_s: a.duration_s, mime_type: a.mime_type, path }));
      }
      await inBatches(l.flashcards, 500, (b) => supabase.from('flashcards').insert(b.map((c) => ({ ...c, lesson_id: id }))));
      idMap.set(l.id, id);
    } catch (err) {
      console.warn('aula não restaurada:', l.title, err);
      failed.push(l.title);
      if (uploaded.length) await supabase.storage.from('audio').remove(uploaded);
      await supabase.from('lessons').delete().eq('id', id);
    }
  }

  const notes = mapStudyNotes(backup.study_notes, idMap);
  if (notes.length) {
    const { error } = await supabase.from('study_notes').insert(notes);
    if (error) console.warn('resumos combinados não restaurados:', error);
  }
  onProgress(add.length, add.length, 'Pronto');
  return { added: idMap.size, skipped, failed };
}
