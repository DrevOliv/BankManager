import { useEffect, useState, useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'bm-theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: theme still applies for this visit */
  }
  window.dispatchEvent(new Event('bm-theme'));
}

export function initTheme() {
  applyTheme(readPref());
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readPref);
  return [pref, (p) => (setPref(p), applyTheme(p))];
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  window.addEventListener('bm-theme', cb);
  return () => {
    mq.removeEventListener('change', cb);
    window.removeEventListener('bm-theme', cb);
  };
}

const isDark = () => {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr) return attr === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export interface ChartColors {
  accent: string;
  accentWash: string;
  income: string;
  muted: string;
  seriesMuted: string;
  grid: string;
  axis: string;
  surface: string;
  ink: string;
  ink2: string;
}

/** Resolved token values for SVG charts, refreshed when the theme changes. */
export function useChartColors(): ChartColors {
  const dark = useSyncExternalStore(subscribe, isDark);
  const [colors, setColors] = useState<ChartColors>(() => read());
  useEffect(() => setColors(read()), [dark]);
  return colors;
}

function read(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    accent: v('--accent'),
    accentWash: v('--accent-wash'),
    income: v('--series-income'),
    muted: v('--muted'),
    seriesMuted: v('--series-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    surface: v('--surface'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
  };
}
