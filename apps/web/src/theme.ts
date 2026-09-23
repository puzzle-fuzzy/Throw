import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'throw-theme';

function currentTheme(): ThemeMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略
  }
}

/** 主题：初始值由 index.html 内联脚本按存储/系统偏好设置（防闪烁），这里只负责切换 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => currentTheme());

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      // 用户没有手动选择时跟随系统（存储值为手动选择）
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch {}
      if (!saved) {
        applyTheme(event.matches ? 'dark' : 'light');
        setTheme(event.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next: ThemeMode = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, []);

  return { theme, toggle };
}
