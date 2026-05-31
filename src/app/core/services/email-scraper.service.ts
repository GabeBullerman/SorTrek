import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Auth, GoogleAuthProvider, signInWithPopup } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { BookingType } from '../models/booking.model';
import { Trip } from '../models/trip.model';

export interface ScannedBooking {
  type: BookingType | 'restaurant';
  title: string;
  provider?: string;
  confirmationNumber?: string;
  checkIn?: string;   // YYYY-MM-DD
  checkOut?: string;  // YYYY-MM-DD
  cost?: number;
  currency?: string;
  selected: boolean;
}

@Injectable({ providedIn: 'root' })
export class EmailScraperService {
  private auth = inject(Auth);
  private http = inject(HttpClient);

  /** Opens a Google consent popup requesting gmail.readonly scope and returns the access token. */
  getGmailToken(): Observable<string | null> {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');

    return from(signInWithPopup(this.auth, provider)).pipe(
      map(result => GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? null),
      catchError(err => {
        console.error('Gmail OAuth error:', err);
        return of(null);
      })
    );
  }

  /** Fetches Gmail messages matching booking senders and parses them with AI. */
  scanEmails(accessToken: string, trip: Trip): Observable<ScannedBooking[]> {
    return this.http.post<{ bookings: ScannedBooking[] }>('/api/email-scraper', {
      accessToken,
      tripDestination: trip.destination,
      tripStartDate: trip.startDate.toDate().toISOString(),
      tripEndDate: trip.endDate.toDate().toISOString(),
    }).pipe(
      map(r => r.bookings ?? []),
      catchError(() => of([] as ScannedBooking[]))
    );
  }
}
