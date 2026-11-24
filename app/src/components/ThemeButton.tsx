import { useState } from 'react';
import { applyTheme, nextTheme, savedTheme, THEMES } from '../lib/theme';
import Icon from './Icon';

const ICON = { system: 'auto', light: 'sun', dark: 'moon' } as const;

/** Um toque troca entre Sistema, Claro e Escuro. */
export default function ThemeButton() {
  const [theme, setTheme] = useState(savedTheme);
  const label = THEMES.find((t) => t.value === theme)?.label ?? 'Sistema';
  const change = () => {
    const next = nextTheme(theme);
    applyTheme(next);
    setTheme(next);
  };
  return (
    <button className="theme-button" onClick={change} aria-label={`Tema: ${label}. Toque para trocar.`}>
      <Icon name={ICON[theme]} size={16} />
      {label}
    </button>
  );
}
