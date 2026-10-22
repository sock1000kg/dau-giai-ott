export const THEME_STORAGE_KEY = 'ott-theme';
export const THEME_CHANGE_EVENT = 'ott-theme-change';

export type Theme = 'light' | 'dark';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function preferredTheme(storage: Storage | null, prefersDark: boolean): Theme {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY) ?? null;
    if (isTheme(stored)) return stored;
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
  return prefersDark ? 'dark' : 'light';
}

function safeStorage(targetWindow: Window): Storage | null {
  try {
    return targetWindow.localStorage;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme, targetDocument: Document = document): void {
  const root = targetDocument.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function initializeTheme(targetWindow: Window = window, targetDocument: Document = document): () => void {
  const storage = safeStorage(targetWindow);
  const media = targetWindow.matchMedia?.('(prefers-color-scheme: dark)');
  const osTheme = () => media?.matches ? 'dark' : 'light';
  const current = () => preferredTheme(storage, media?.matches ?? false);

  applyTheme(current(), targetDocument);

  const onMediaChange = () => {
    if (storageHasNoChoice(storage)) {
      applyTheme(osTheme(), targetDocument);
      targetDocument.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: osTheme() } }));
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const theme = isTheme(event.newValue) ? event.newValue : osTheme();
    applyTheme(theme, targetDocument);
    targetDocument.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
  };

  media?.addEventListener?.('change', onMediaChange);
  // Safari versions before MediaQueryList.addEventListener use addListener.
  if (media && !media.addEventListener) media.addListener(onMediaChange);
  targetWindow.addEventListener('storage', onStorage);

  return () => {
    media?.removeEventListener?.('change', onMediaChange);
    if (media && !media.removeEventListener) media.removeListener(onMediaChange);
    targetWindow.removeEventListener('storage', onStorage);
  };
}

function storageHasNoChoice(storage: Storage | null): boolean {
  try {
    return !isTheme(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return true;
  }
}

export function selectTheme(theme: Theme, targetWindow: Window = window, targetDocument: Document = document): void {
  const storage = safeStorage(targetWindow);
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Keep the current page usable even when persistence is blocked.
  }
  applyTheme(theme, targetDocument);
  targetDocument.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
}
