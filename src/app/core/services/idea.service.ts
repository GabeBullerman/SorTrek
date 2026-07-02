import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, deleteDoc, query, where, serverTimestamp,
} from '@angular/fire/firestore';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { TripIdea } from '../models/trip-idea.model';

export interface LinkPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

@Injectable({ providedIn: 'root' })
export class IdeaService {
  private firestore = inject(Firestore);
  private http = inject(HttpClient);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getIdeas(tripId: string): Observable<TripIdea[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'tripIdeas'),
        where('tripId', '==', tripId)
      );
      return collectionData(q, { idField: 'id' }) as Observable<TripIdea[]>;
    });
  }

  /** Fetch title/thumbnail/site for a URL (server-side, one-time at add). */
  fetchPreview(url: string): Observable<LinkPreview> {
    return this.http.post<LinkPreview>('/api/link-preview', { url }).pipe(
      map(p => ({
        title: p.title ?? null,
        description: p.description ?? null,
        image: p.image ?? null,
        siteName: p.siteName ?? null,
      })),
      catchError(() => of({ title: null, description: null, image: null, siteName: null })),
    );
  }

  createIdea(idea: Omit<TripIdea, 'id' | 'createdAt'>) {
    // Firestore rejects undefined — keep only set fields.
    const data: Record<string, unknown> = { createdAt: serverTimestamp() };
    for (const [k, v] of Object.entries(idea)) {
      if (v !== undefined && v !== null && v !== '') data[k] = v;
    }
    return this.run(() => addDoc(collection(this.firestore, 'tripIdeas'), data));
  }

  deleteIdea(id: string) {
    return this.run(() => deleteDoc(doc(this.firestore, 'tripIdeas', id)));
  }
}
