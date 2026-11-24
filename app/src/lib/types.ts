export type LessonStatus = 'recording' | 'uploading' | 'processing' | 'ready' | 'error';

export type Lesson = {
  id: string;
  user_id: string;
  title: string;
  subject: string | null;
  recorded_at: string;
  duration_s: number;
  status: LessonStatus;
  processed_blocks: number;
  total_blocks: number | null;
  error_message: string | null;
  audio_expires_at: string;
  audio_deleted: boolean;
  expected_chunks?: number | null;
  notes?: string;
  speaker_names?: Record<string, string> | null;
};

export type AudioChunk = {
  lesson_id: string;
  idx: number;
  start_s: number;
  duration_s: number;
  path: string;
  mime_type?: string;
};

export type Segment = {
  id?: number;
  start_s: number;
  end_s: number;
  text: string;
  speaker: string | null;
};
