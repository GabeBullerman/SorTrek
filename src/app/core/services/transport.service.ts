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

export interface FlightOffer {
  id: string;
  departure: string | null;
  arrival: string | null;
  duration: string | null;
  stops: number;
  airline: string | null;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  price: { amount: number; currency: string } | null;
}

export interface HotelOffer {
  hotelId: string | null;
  hotelName: string;
  cityCode: string;
  checkIn: string | null;
  checkOut: string | null;
  price: { amount: number; currency: string } | null;
  rating: number | null;
  roomType: string | null;
  boardType: string | null;
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

  searchFlights(flightOrigin: string, flightDestination: string, flightDate: string): Observable<{
    flights: FlightOffer[];
    fromAirport?: { code: string; name: string };
    toAirport?: { code: string; name: string };
    error?: string;
  }> {
    return this.http.post<any>('/api/transport', {
      action: 'flights', flightOrigin, flightDestination, flightDate,
    }).pipe(catchError(() => of({ flights: [], error: 'Could not reach flights API' })));
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
      catchError(() => of('Could not generate plan. Check that GROQ_API_KEY is configured.'))
    );
  }

  searchHotels(hotelDestination: string, hotelCheckIn: string, hotelCheckOut: string): Observable<{
    hotels: HotelOffer[];
    cityCode?: string;
    error?: string;
  }> {
    return this.http.post<any>('/api/transport', {
      action: 'hotels', hotelDestination, hotelCheckIn, hotelCheckOut,
    }).pipe(catchError(() => of({ hotels: [], error: 'Could not reach hotels API' })));
  }
}
