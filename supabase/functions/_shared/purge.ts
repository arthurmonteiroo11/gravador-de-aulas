export type PurgeDeps = {
  listExpired: () => Promise<Array<{ id: string }>>;
  listPaths: (lessonId: string) => Promise<string[]>;
  removeFiles: (paths: string[]) => Promise<void>;
  deleteChunkRows: (lessonId: string) => Promise<void>;
  markDeleted: (lessonId: string) => Promise<void>;
};

/** Apaga o áudio das aulas com mais de 30 dias. Transcrição, reescrita e resumo ficam. */
export async function purgeExpired(deps: PurgeDeps): Promise<{ purged: number; failed: number }> {
  let purged = 0;
  let failed = 0;
  for (const { id } of await deps.listExpired()) {
    try {
      const paths = await deps.listPaths(id);
      if (paths.length) await deps.removeFiles(paths);
      await deps.deleteChunkRows(id);
      await deps.markDeleted(id);
      purged++;
    } catch {
      failed++;
    }
  }
  return { purged, failed };
}
