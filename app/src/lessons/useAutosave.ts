import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const RETRY_MS = 5_000;

/**
 * Salva sozinho um tempo depois que a pessoa para de digitar.
 * Um envio por vez, sempre com o texto mais recente; tenta de novo se falhar;
 * e salva na hora quando o app vai para o fundo ou a tela fecha.
 */
export function useAutosave(value: string, save: (v: string) => Promise<void>, delayMs = 800): SaveState {
  const [state, setState] = useState<SaveState>('idle');
  const saved = useRef(value);
  const latest = useRef(value);
  const saveRef = useRef(save);
  const running = useRef<Promise<void> | null>(null);
  latest.current = value;
  saveRef.current = save;

  const flush = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    if (latest.current === saved.current) return Promise.resolve();
    const run = async () => {
      // Repete enquanto a pessoa tiver digitado algo novo durante o envio.
      while (latest.current !== saved.current) {
        const v = latest.current;
        setState('saving');
        await saveRef.current(v);
        saved.current = v;
      }
      setState('saved');
    };
    running.current = run()
      .catch(() => setState('error'))
      .finally(() => {
        running.current = null;
      });
    return running.current;
  }, []);

  useEffect(() => {
    if (value === saved.current) return;
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, flush]);

  // Falhou (sem internet): tenta de novo de tempos em tempos.
  useEffect(() => {
    if (state !== 'error') return;
    const timer = setTimeout(() => void flush(), RETRY_MS);
    return () => clearTimeout(timer);
  }, [state, flush]);

  // No iPhone o app pode ser fechado em segundo plano sem aviso: salva ao sair da tela.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  return state;
}
