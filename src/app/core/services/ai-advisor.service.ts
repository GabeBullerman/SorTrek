import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Trip } from '../models/trip.model';
import { PackingCategory } from '../models/packing-item.model';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PackingSuggestion {
  name: string;
  category: PackingCategory;
  quantity: number;
  selected: boolean;
}

@Injectable({ providedIn: 'root' })
export class AiAdvisorService {
  private http = inject(HttpClient);

  private tripContext(trip: Trip) {
    return {
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate.toDate().toISOString(),
      endDate: trip.endDate.toDate().toISOString(),
    };
  }

  chat(trip: Trip, messages: AiMessage[]): Observable<string> {
    return this.http.post<{ reply: string }>('/api/ai-advisor', {
      type: 'chat',
      trip: this.tripContext(trip),
      messages,
    }).pipe(
      map(r => r.reply),
      catchError(() => of('Sorry, the AI assistant is unavailable right now. Please try again in a moment.'))
    );
  }

  getPackingSuggestions(trip: Trip, existingItems: string[]): Observable<PackingSuggestion[]> {
    return this.http.post<{ suggestions: PackingSuggestion[] }>('/api/ai-advisor', {
      type: 'packing',
      trip: this.tripContext(trip),
      existingItems,
    }).pipe(
      map(r => (r.suggestions ?? []).map(s => ({ ...s, selected: true }))),
      catchError(() => of([] as PackingSuggestion[]))
    );
  }
}
