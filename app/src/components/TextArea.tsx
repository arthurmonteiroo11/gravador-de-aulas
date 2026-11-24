import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** Caixa de texto que cresce com o conteúdo, sem barra de rolagem própria. */
export default function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}
