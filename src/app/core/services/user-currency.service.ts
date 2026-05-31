import { Injectable, inject, signal, effect } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { UserService } from './user.service';
import { CurrencyService } from './currency.service';

@Injectable({ providedIn: 'root' })
export class UserCurrencyService {
  private auth            = inject(Auth);
  private userService     = inject(UserService);
  private currencyService = inject(CurrencyService);

  /** The user's chosen home currency (e.g. "USD"). */
  readonly homeCurrency = signal<string | null>(null);

  /** Cached exchange rates: key = "FROM-TO", value = rate. */
  private rateCache = new Map<string, number>();

  constructor() {
    this.auth.onAuthStateChanged(user => {
      if (!user) { this.homeCurrency.set(null); return; }
      this.userService.getProfile(user.uid).subscribe(profile => {
        this.homeCurrency.set(profile?.homeCurrency ?? null);
      });
    });
  }

  /**
   * Convert amount from tripCurrency to user's home currency.
   * Returns null if home currency === trip currency or not loaded yet.
   */
  convert(amount: number, fromCurrency: string): number | null {
    const home = this.homeCurrency();
    if (!home || home === fromCurrency) return null;

    const key = `${fromCurrency}-${home}`;
    if (this.rateCache.has(key)) {
      return amount * this.rateCache.get(key)!;
    }

    // Kick off a fetch and cache the result for next render
    this.currencyService.getRate(fromCurrency, home).subscribe(r => {
      if (r) this.rateCache.set(key, r.rate);
    });

    return null; // will show on next change-detection cycle once rate arrives
  }
}
