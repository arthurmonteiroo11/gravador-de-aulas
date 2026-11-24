export type Theme = 'system' | 'light' | 'dark';

const KEY = 'tema';
export const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** Sistema: segue o iPhone. Claro ou Escuro: fixa, e fica guardado neste aparelho. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Sem armazenamento (aba privada): vale só até fechar.
  }
}

export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.findIndex((x) => x.value === t) + 1) % THEMES.length].value;
