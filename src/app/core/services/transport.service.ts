import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface JourneyLeg {
  mode: string;
  name: string | null;
  product: string | null;
  from: string | null;
  to: string | null;
  departure: string | null;
  arrival: string | null;
}

export interface Journey {
  id: string;
  departure: string | null;
  arrival: string | null;
  duration: string | null;
  changes: number;
  legs: JourneyLeg[];
  price: { amount: number; currency: string } | null;
}

export interface LocalOption {
  type: string;
  count: number;
}

export interface NearbyStop {
  name: string;
  id: string;
  distance: number;
  products: Record<string, boolean>;
}

@Injectable({ providedIn: 'root' })
export class TransportService {
  private http = inject(HttpClient);

  searchTrains(origin: string, destination: string, departure: string): Observable<{
    journeys: Journey[];
    fromStation?: { name: string };
    toStation?: { name: string };
    error?: string;
  }> {
    return this.http.post<any>('/api/transport', {
      action: 'search', origin, destination, departure,
    }).pipe(catchError(() => of({ journeys: [], error: 'Could not reach transport API' })));
  }

  getLocalOptions(lat: number, lon: number): Observable<{
    localSummary: LocalOption[];
    nearbyStops: NearbyStop[];
  }> {
    return this.http.post<any>('/api/transport', {
      action: 'local', lat, lon,
    }).pipe(catchError(() => of({ localSummary: [], nearbyStops: [] })));
  }

  getAIPlan(tripName: string, destination: string, journeys: Journey[], localSummary: LocalOption[]): Observable<string> {
    return this.http.post<{ plan: string }>('/api/transport', {
      action: 'plan', tripName, destination, journeys, localSummary,
    }).pipe(
      map(r => r.plan),
      catchError(() => of('Could not generate a plan right now. Please try again in a moment.'))
    );
  }

}
