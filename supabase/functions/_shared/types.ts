export type LessonStatus = 'recording' | 'uploading' | 'processing' | 'ready' | 'error';
export type LessonRow = {
  id: string;
  status: LessonStatus;
  expected_chunks: number | null;
  processed_blocks: number;
  total_blocks: number | null;
  block_failures: number;
  recorded_at: string;
  /** Quando a aula foi criada no app. Numa importação, recorded_at é a data do arquivo, bem anterior. */
  created_at?: string | null;
  duration_s: number;
  error_message?: string | null;
};
export type AudioChunk = { lesson_id: string; idx: number; start_s: number; duration_s: number; path: string; mime_type: string };
export type Segment = { start_s: number; end_s: number; text: string; speaker: string | null };
export type ModelSegment = { part: number; start: number; end: number; text: string };
export type AudioPart = { data: Uint8Array; mimeType: string };
