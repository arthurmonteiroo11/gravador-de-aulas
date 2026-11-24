type Pausable = { state: string; pause: () => Promise<void> | void };

/** Pausa a gravação quando a página sai da frente (tela bloqueada, troca de app). */
export function watchLifecycle(rec: Pausable): () => void {
  const pauseIfRecording = () => {
    if (rec.state === 'recording') void rec.pause();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') pauseIfRecording();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', pauseIfRecording);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', pauseIfRecording);
  };
}
