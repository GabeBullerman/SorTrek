import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, shareReplay } from 'rxjs/operators';

export interface RateResult {
  rate: number;
  from: string;
  to: string;
  fetchedAt: Date;
}

/**
 * Frankfurter's ECB rate API. NOTE: the old `api.frankfurter.app` host now
 * 301-redirects here, and that redirect carries no CORS headers — so browsers
 * block the whole request chain. Always call the .dev/v1 host directly.
 */
const RATES_API = 'https://api.frankfurter.dev/v1';

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private http = inject(HttpClient);
  private cache = new Map<string, Observable<RateResult | null>>();

  getRate(from: string, to: string): Observable<RateResult | null> {
    if (from === to) {
      return of({ rate: 1, from, to, fetchedAt: new Date() });
    }

    const key = `${from}-${to}`;
    if (!this.cache.has(key)) {
      const req$ = this.http
        .get<{ rates: Record<string, number> }>(
          `${RATES_API}/latest?from=${from}&to=${to}`
        )
        .pipe(
          map(res => {
            const rate = res?.rates?.[to];
            if (typeof rate !== 'number') throw new Error('Rate missing from response');
            return { rate, from, to, fetchedAt: new Date() };
          }),
          catchError(() => {
            // Don't let a transient failure poison the cache — otherwise the
            // shareReplay would hand every later caller the same null forever.
            this.cache.delete(key);
            return of(null);
          }),
          shareReplay(1)
        );
      this.cache.set(key, req$);
    }
    return this.cache.get(key)!;
  }
}
