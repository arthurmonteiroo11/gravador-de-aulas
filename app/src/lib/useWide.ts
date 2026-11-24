import { useEffect, useState } from 'react';

/** Tela de computador: a aula ganha uma coluna ao lado para anotações e perguntas. */
export const WIDE_QUERY = '(min-width: 1100px)';

export function useWide(): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}
