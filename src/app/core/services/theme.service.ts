import { Injectable, signal, computed, effect } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePalette = 'indigo' | 'pink' | 'red' | 'teal' | 'purple';

export interface PaletteDef {
  id: ThemePalette;
  label: string;
  /** Representative swatch color shown in the picker. */
  swatch: string;
}

export const PALETTES: PaletteDef[] = [
  { id: 'indigo', label: 'Indigo',      swatch: '#1a237e' },
  { id: 'pink',   label: 'Pastel Pink', swatch: '#ec407a' },
  { id: 'red',    label: 'Crimson',     swatch: '#c62828' },
  { id: 'teal',   label: 'Teal',        swatch: '#00695c' },
  { id: 'purple', label: 'Purple',      swatch: '#6a1b9a' },
];

const STORAGE_KEY = 'sortrek_theme';
const PALETTE_KEY = 'sortrek_palette';

/**
 * Owns the app's light/dark theme. The user's choice is one of:
 *   - 'light' / 'dark' — explicit override
 *   - 'system'         — follow the OS preference (default)
 *
 * The resolved theme is applied by toggling `.dark` on <html>, which flips both
 * the design tokens (styles/_tokens.scss) and the Material dark theme block.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** The user's selected mode (persisted). */
  readonly mode = signal<ThemeMode>(this.readStoredMode());

  /** The user's selected color palette (persisted). */
  readonly palette = signal<ThemePalette>(this.readStoredPalette());

  private readonly systemPrefersDark = signal<boolean>(
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );

  /** The actually-applied theme after resolving 'system'. */
  readonly resolved = computed<'light' | 'dark'>(() => {
    const m = this.mode();
    if (m === 'system') return this.systemPrefersDark() ? 'dark' : 'light';
    return m;
  });

  readonly isDark = computed(() => this.resolved() === 'dark');

  constructor() {
    // Keep <html> and storage in sync whenever the resolved theme changes.
    effect(() => {
      const dark = this.isDark();
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', dark);
      }
    });

    effect(() => {
      try { localStorage.setItem(STORAGE_KEY, this.mode()); } catch { /* ignore */ }
    });

    // Apply the palette as a data-theme attribute on <html> and persist it.
    effect(() => {
      const p = this.palette();
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', p);
      }
      try { localStorage.setItem(PALETTE_KEY, p); } catch { /* ignore */ }
    });

    // React to OS theme changes while in 'system' mode.
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', e => this.systemPrefersDark.set(e.matches));
    }
  }

  setMode(mode: ThemeMode) {
    this.mode.set(mode);
  }

  setPalette(palette: ThemePalette) {
    this.palette.set(palette);
  }

  /** Convenience toggle for a simple sun/moon button: flips light <-> dark. */
  toggle() {
    this.mode.set(this.isDark() ? 'light' : 'dark');
  }

  private readStoredMode(): ThemeMode {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch { /* ignore */ }
    return 'system';
  }

  private readStoredPalette(): ThemePalette {
    try {
      const v = localStorage.getItem(PALETTE_KEY);
      if (PALETTES.some(p => p.id === v)) return v as ThemePalette;
    } catch { /* ignore */ }
    return 'indigo';
  }
}
