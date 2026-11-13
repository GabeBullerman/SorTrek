import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc, updateDoc, deleteDoc,
  doc, query, where, serverTimestamp, limit,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TripParticipant } from '../models/trip-participant.model';

@Injectable({ providedIn: 'root' })
export class ParticipantService {
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getParticipants(tripId: string): Observable<TripParticipant[]> {
    return this.run(() =>
      collectionData(
        query(collection(this.firestore, 'participants'), where('tripId', '==', tripId),
        limit(200)
      ),
        { idField: 'id' }
      ) as Observable<TripParticipant[]>
    );
  }

  // All accepted participations for a user — used to show shared trips in the list
  getAcceptedParticipations(userId: string): Observable<TripParticipant[]> {
    return this.run(() =>
      (collectionData(
        query(collection(this.firestore, 'participants'), where('userId', '==', userId),
        limit(200)
      ),
        { idField: 'id' }
      ) as Observable<TripParticipant[]>).pipe(
        map(ps => ps.filter(p => p.inviteStatus === 'accepted'))
      )
    );
  }

  // Pending invites by email — called on login to auto-accept
  getPendingInvitesByEmail(email: string): Observable<TripParticipant[]> {
    return this.run(() =>
      (collectionData(
        query(collection(this.firestore, 'participants'), where('inviteEmail', '==', email),
        limit(200)
      ),
        { idField: 'id' }
      ) as Observable<TripParticipant[]>).pipe(
        map(ps => ps.filter(p => p.inviteStatus === 'pending'))
      )
    );
  }

  addParticipant(p: Omit<TripParticipant, 'id' | 'createdAt'>) {
    return this.run(() =>
      addDoc(collection(this.firestore, 'participants'), {
        ...p,
        createdAt: serverTimestamp(),
      })
    );
  }

  updateParticipant(id: string, changes: Partial<TripParticipant>) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'participants', id), changes)
    );
  }

  // Link a user account to a participant and mark as accepted
  acceptInvite(participantId: string, userId: string) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'participants', participantId), {
        userId,
        inviteStatus: 'accepted',
      })
    );
  }

  deleteParticipant(id: string) {
    return this.run(() =>
      deleteDoc(doc(this.firestore, 'participants', id))
    );
  }
}
