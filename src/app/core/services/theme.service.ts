import { Injectable, signal, computed, effect } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'sortrek_theme';

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

    // React to OS theme changes while in 'system' mode.
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', e => this.systemPrefersDark.set(e.matches));
    }
  }

  setMode(mode: ThemeMode) {
    this.mode.set(mode);
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
}
