import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, doc, setDoc, getDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
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
  private http      = inject(HttpClient);
  private auth      = inject(Auth);
  private firestore = inject(Firestore);

  /** Create a Link token (used by Plaid Link SDK to open the bank connection UI). */
  createLinkToken(): Observable<string> {
    return this.http.post<{ link_token: string }>('/api/plaid-link', {
      userId: this.auth.currentUser?.uid ?? 'anonymous',
    }).pipe(map(r => r.link_token));
  }

  /** Exchange the public token Plaid Link returns for a persistent access token, save to Firestore. */
  exchangeAndSave(publicToken: string): Observable<string> {
    return this.http.post<{ accessToken: string }>('/api/plaid-exchange', { publicToken }).pipe(
      switchMap(({ accessToken }) => {
        const uid = this.auth.currentUser?.uid;
        if (!uid) return of(accessToken);
        // Store encrypted-at-rest by Firestore; never send to client in plain text again
        return from(setDoc(doc(this.firestore, 'plaid_tokens', uid), { accessToken }, { merge: true }))
          .pipe(map(() => accessToken));
      })
    );
  }

  /** Fetch saved access token from Firestore, then pull transactions for the date range. */
  getTransactions(startDate: string, endDate: string): Observable<PlaidTransaction[]> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return of([]);

    return from(getDoc(doc(this.firestore, 'plaid_tokens', uid))).pipe(
      switchMap(snap => {
        const token = snap.data()?.['accessToken'];
        if (!token) return of([]);
        return this.http.post<{ transactions: PlaidTransaction[] }>('/api/plaid-transactions', {
          accessToken: token,
          startDate,
          endDate,
        }).pipe(map(r => r.transactions ?? []));
      }),
      catchError(() => of([] as PlaidTransaction[]))
    );
  }

  /** Check if user has a saved Plaid token. */
  isConnected(): Observable<boolean> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return of(false);
    return from(getDoc(doc(this.firestore, 'plaid_tokens', uid))).pipe(
      map(snap => snap.exists() && !!snap.data()?.['accessToken']),
      catchError(() => of(false))
    );
  }
}
