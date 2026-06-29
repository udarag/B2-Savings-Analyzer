'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export type ThemePreference = 'light' | 'dark';

// localStorage key for the explicit user choice, and a same-tab custom event used
// to broadcast changes (the native `storage` event only fires in *other* tabs).
export const THEME_STORAGE_KEY = 'b2-savings-theme';
export const THEME_CHANGE_EVENT = 'b2-theme-change';

/** True on customer-facing report routes, which are always rendered in light mode. */
export function isReportPath(pathname: string): boolean {
  return /^\/analyses\/[^/]+\/report(?:\/|$)/.test(pathname);
}

/** Resolves the effective theme: explicit stored choice if set, else OS preference. */
export function getPreferredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'light';

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Ignore blocked storage and fall back to system preference.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies the theme to the document root; report paths are forced to light regardless. */
export function applyTheme(theme: ThemePreference, pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  if (typeof document === 'undefined') return;

  // Dark only ever applies off the report routes — the customer report must look
  // identical in-app, when shared, and when printed to PDF.
  const darkEnabled = theme === 'dark' && !isReportPath(pathname);
  const root = document.documentElement;

  root.classList.toggle('dark', darkEnabled);
  root.dataset.theme = darkEnabled ? 'dark' : 'light';
  root.style.colorScheme = darkEnabled ? 'dark' : 'light';
}

/** Persists an explicit theme choice, applies it, and notifies same-tab listeners. */
export function setThemePreference(theme: ThemePreference) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }

  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
}

/**
 * Headless controller: keeps the document theme in sync with the stored/system
 * preference. Re-runs on navigation so entering or leaving a report path flips
 * dark mode on/off, and listens for cross-tab, same-tab, and OS changes.
 */
export function ThemeController() {
  const pathname = usePathname();

  useEffect(() => {
    const syncTheme = () => applyTheme(getPreferredTheme(), pathname);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      // An explicit user choice wins over the OS; only follow system changes
      // when the user hasn't picked a theme.
      try {
        if (window.localStorage.getItem(THEME_STORAGE_KEY)) return;
      } catch {
        // If storage is blocked, system preference remains the best signal.
      }
      syncTheme();
    };

    syncTheme();
    window.addEventListener('storage', syncTheme);
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    media.addEventListener('change', handleSystemChange);

    return () => {
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      media.removeEventListener('change', handleSystemChange);
    };
  }, [pathname]);

  return null;
}
