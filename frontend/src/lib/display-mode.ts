'use client';

import { useEffect, useState } from 'react';

/**
 * Desktop layout mode: `professional` is the centered single-column layout,
 * `traditional` adds a resizable app sidebar. Persisted per browser and
 * synced across tabs/components via a custom event.
 */
export type DisplayMode = 'professional' | 'traditional';

const STORAGE_KEY = 'swarmdev.displayMode';
const CHANGE_EVENT = 'swarmdev:display-mode-change';
const DEFAULT_MODE: DisplayMode = 'traditional';

function isDisplayMode(value: string | null | undefined): value is DisplayMode {
  return value === 'professional' || value === 'traditional';
}

function readDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isDisplayMode(stored) ? stored : DEFAULT_MODE;
}

export function setStoredDisplayMode(mode: DisplayMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  document.documentElement.dataset.displayMode = mode;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { mode } }));
}

export function useDisplayMode() {
  const [mode, setMode] = useState<DisplayMode>(DEFAULT_MODE);

  useEffect(() => {
    const sync = () => {
      const next = readDisplayMode();
      setMode(next);
      document.documentElement.dataset.displayMode = next;
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  return [mode, setStoredDisplayMode] as const;
}
