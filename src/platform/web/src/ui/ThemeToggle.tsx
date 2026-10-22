import { useEffect, useState } from 'react';
import { selectTheme, THEME_CHANGE_EVENT, type Theme } from './theme.ts';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** A two-state, accessible control that persists the user's explicit theme choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    document.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => document.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';

  return (
    <button
      type="button"
      className="ui-button ui-button--secondary ui-theme-toggle"
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title={label}
      onClick={() => selectTheme(nextTheme)}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      <span>{theme === 'dark' ? 'Sáng' : 'Tối'}</span>
    </button>
  );
}
