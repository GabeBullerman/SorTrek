import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, updateDoc, deleteDoc, query, where, deleteField,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { ItineraryItem } from '../models/itinerary-item.model';

@Injectable({ providedIn: 'root' })
export class ItineraryService {
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getItems(tripId: string): Observable<ItineraryItem[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'itinerary'),
        where('tripId', '==', tripId)
      );
      return collectionData(q, { idField: 'id' }) as Observable<ItineraryItem[]>;
    });
  }

  createItem(item: Omit<ItineraryItem, 'id'>) {
    return this.run(() => addDoc(collection(this.firestore, 'itinerary'), stripUndefined(item)));
  }

  updateItem(id: string, changes: Partial<ItineraryItem>) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'itinerary', id), stripUndefined(changes))
    );
  }

  deleteItem(id: string) {
    return this.run(() => deleteDoc(doc(this.firestore, 'itinerary', id)));
  }

  /** Approve a proposal: clear the proposed flag and drop the vote tally. */
  approveItem(id: string) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'itinerary', id), {
        proposed: false,
        votes: deleteField(),
      })
    );
  }

  /**
   * Cast, change, or retract the caller's vote on a proposed item. Writes only
   * `votes.<uid>` so the security rules can verify a member touches nothing
   * but their own vote.
   */
  setVote(id: string, uid: string, vote: 'up' | 'down' | null) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'itinerary', id), {
        [`votes.${uid}`]: vote ?? deleteField(),
      })
    );
  }
}

/**
 * Firestore rejects `undefined` field values (ignoreUndefinedProperties is off),
 * and addDoc throws synchronously when it sees one — which left the "add
 * activity" dialog spinning forever. Drop undefined keys before writing.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
