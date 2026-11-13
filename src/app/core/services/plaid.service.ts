import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, Subject } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';

export interface PlaidTransaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  merchant: string;
  pending: boolean;
  lat: number | null;
  lon: number | null;
}

@Injectable({ providedIn: 'root' })
export class PlaidService {
  private http = inject(HttpClient);

  /** Create a Link token (used by Plaid Link SDK to open the bank connection UI).
   *  The server derives the Plaid user id from the verified ID token, so no
   *  identity is sent from here. */
  createLinkToken(): Observable<string> {
    return this.http.post<{ link_token: string }>('/api/plaid', { action: 'link' })
      .pipe(map(r => r.link_token));
  }

  /** Hand the public token to the server, which exchanges it and stores the
   *  resulting access token itself. The access token is a bank credential and
   *  never reaches this client — there is nothing here to save. */
  exchange(publicToken: string): Observable<boolean> {
    return this.http.post<{ connected: boolean }>('/api/plaid', { action: 'exchange', publicToken })
      .pipe(map(r => !!r.connected), catchError(() => of(false)));
  }

  /** Transactions for the range. The server looks the token up by the caller's
   *  uid; this request carries no credential. */
  getTransactions(startDate: string, endDate: string): Observable<PlaidTransaction[]> {
    return this.http.post<{ transactions: PlaidTransaction[] }>('/api/plaid', {
      action: 'transactions', startDate, endDate,
    }).pipe(
      map(r => r.transactions ?? []),
      catchError(() => of([] as PlaidTransaction[]))
    );
  }

  /** Whether a bank is linked. `shouldRelink` is true when the stored token
   *  predates the server-side move and was readable by the browser. */
  connection(): Observable<{ connected: boolean; shouldRelink: boolean }> {
    return this.http.post<{ connected: boolean; shouldRelink: boolean }>('/api/plaid', { action: 'status' })
      .pipe(catchError(() => of({ connected: false, shouldRelink: false })));
  }

  isConnected(): Observable<boolean> {
    return this.connection().pipe(map(c => c.connected));
  }

  /** Disconnect — the server removes the item at Plaid and deletes the token. */
  disconnect(): Observable<boolean> {
    return this.http.post<{ connected: boolean }>('/api/plaid', { action: 'disconnect' })
      .pipe(map(r => !r.connected), catchError(() => of(false)));
  }

  /**
   * Full Plaid Link flow:
   * 1. Get link_token from backend
   * 2. Load Plaid Link JS SDK
   * 3. Open the bank connection UI
   * 4. On success exchange public_token for access_token
   * Returns an Observable that emits true on success, false on exit/error.
   */
  openLink(): Observable<boolean> {
    const result$ = new Subject<boolean>();

    this.createLinkToken().subscribe({
      next: linkToken => {
        this.loadPlaidScript().then(() => {
          const handler = (window as any).Plaid.create({
            token: linkToken,
            onSuccess: (publicToken: string) => {
              this.exchange(publicToken).subscribe({
                next: () => { result$.next(true); result$.complete(); },
                error: () => { result$.next(false); result$.complete(); },
              });
            },
            onExit: () => { result$.next(false); result$.complete(); },
          });
          handler.open();
        });
      },
      error: () => { result$.next(false); result$.complete(); },
    });

    return result$.asObservable();
  }

  private loadPlaidScript(): Promise<void> {
    if ((window as any).Plaid) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.onload  = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Plaid Link'));
      document.head.appendChild(script);
    });
  }
}
