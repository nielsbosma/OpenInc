import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'openinc-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const ThemeContext = createContext<{ theme: ThemeChoice; resolved: 'light' | 'dark'; setTheme: (t: ThemeChoice) => void }>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(read);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener('change', listener);
    return () => m.removeEventListener('change', listener);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setTheme = useCallback((t: ThemeChoice) => {
    try {
      if (t === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {}
    setThemeState(t);
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
