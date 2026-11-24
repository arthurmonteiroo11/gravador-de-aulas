// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { crc32, makeZip, openZip } from './zip';
import { audioEstimateMb, backupName, lessonRow, mapStudyNotes, parseBackup, planImport, type Backup, type BackupLesson } from './backup';

const enc = new TextEncoder();

describe('zip', () => {
  it('crc32 bate com o valor conhecido', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('o que entra sai igual, com nomes acentuados', async () => {
    const audio = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    const zip = await openZip(makeZip([
      { name: 'backup.json', data: enc.encode('{"a":"ação"}') },
      { name: 'audio/aula-ç/0.m4a', data: audio },
    ]));
    expect(zip.names).toEqual(['backup.json', 'audio/aula-ç/0.m4a']);
    expect(new TextDecoder().decode(await zip.read('backup.json'))).toBe('{"a":"ação"}');
    expect(await zip.read('audio/aula-ç/0.m4a')).toEqual(audio);
  });

  it('arquivo qualquer não passa por backup', async () => {
    await expect(openZip(new Blob(['não é zip']))).rejects.toThrow('não é um backup');
  });

  it('arquivo corrompido é recusado', async () => {
    const blob = makeZip([{ name: 'backup.json', data: enc.encode('{"ok":true}') }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[31 + 'backup.json'.length] ^= 0xff;
    const zip = await openZip(new Blob([bytes]));
    await expect(zip.read('backup.json')).rejects.toThrow('danificado');
  });
});

const lesson = (over: Partial<BackupLesson> = {}): BackupLesson => ({
  id: 'old-1', title: 'Revolução Industrial', subject: 'História', recorded_at: '2026-11-21T13:00:00+00:00', duration_s: 3000,
  status: 'ready', notes: '', error_message: null, total_blocks: 5, processed_blocks: 5,
  segments: [], outputs: [], flashcards: [], audio: [], ...over,
});

const backup = (lessons: BackupLesson[], study_notes: Backup['study_notes'] = []): Backup => ({
  app: 'gravador-de-aulas', version: 1, exported_at: '2026-11-24T00:00:00Z', with_audio: false, subjects: [], lessons, study_notes,
});

describe('backup', () => {
  it('restaurar de novo não duplica: mesma aula, mesmo horário', () => {
    const b = backup([lesson(), lesson({ id: 'old-2', title: 'Iluminismo' })]);
    const plan = planImport(b, [{ title: 'Revolução Industrial', recorded_at: '2026-11-21T13:00:00.000Z' }]);
    expect(plan.skipped).toBe(1);
    expect(plan.add.map((l) => l.title)).toEqual(['Iluminismo']);
  });

  it('aula parada no meio volta como erro, sem prender o servidor', () => {
    const row = lessonRow(lesson({ status: 'processing' }), 'new', true, new Date('2026-11-24T00:00:00Z'));
    expect(row.status).toBe('error');
    expect(row.audio_deleted).toBe(false);
    expect(row.audio_expires_at).toBe('2026-12-24T00:00:00.000Z');
    expect(lessonRow(lesson(), 'new', false).audio_deleted).toBe(true);
  });

  it('resumo combinado aponta para as aulas novas e some se nenhuma voltou', () => {
    const notes = [
      { title: 'A', lesson_ids: ['old-1', 'old-2'], content_md: '#', model: null, created_at: 'x' },
      { title: 'B', lesson_ids: ['old-3'], content_md: '#', model: null, created_at: 'x' },
    ];
    expect(mapStudyNotes(notes, new Map([['old-1', 'n1']]))).toEqual([{ title: 'A', lesson_ids: ['n1'], content_md: '#', model: null, created_at: 'x' }]);
  });

  it('recusa arquivo de outro app e versão mais nova', () => {
    expect(() => parseBackup('{"app":"outro","lessons":[]}')).toThrow('não é um backup');
    expect(() => parseBackup('{"app":"gravador-de-aulas","version":9,"lessons":[]}')).toThrow('versão mais nova');
    expect(parseBackup('{"app":"gravador-de-aulas","version":1,"lessons":[]}').subjects).toEqual([]);
  });

  it('estimativa do áudio e nome do arquivo', () => {
    expect(audioEstimateMb([{ duration_s: 5400, audio_deleted: false }, { duration_s: 600, audio_deleted: true }])).toBe(45);
    expect(backupName(new Date(2026, 10, 4))).toBe('aulas-backup-2026-11-04.zip');
  });
});
