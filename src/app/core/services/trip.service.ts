import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc, docData,
  addDoc, updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, getDocs, arrayUnion, arrayRemove,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Trip } from '../models/trip.model';
import { TripParticipant } from '../models/trip-participant.model';
import { AuthService } from './auth.service';
import { ParticipantService } from './participant.service';

@Injectable({ providedIn: 'root' })
export class TripService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);
  private participantService = inject(ParticipantService);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getTrips(): Observable<Trip[]> {
    const userId = this.auth.currentUser?.uid;

    // Trips owned by the user
    const own$ = this.run(() =>
      collectionData(
        query(collection(this.firestore, 'trips'),
          where('userId', '==', userId),
          orderBy('startDate', 'desc')
        ),
        { idField: 'id' }
      ) as Observable<Trip[]>
    );

    // Trips where user is in collaboratorIds
    const collab$ = this.run(() =>
      collectionData(
        query(collection(this.firestore, 'trips'),
          where('collaboratorIds', 'array-contains', userId)
        ),
        { idField: 'id' }
      ) as Observable<Trip[]>
    );

    // Trips where user is an accepted participant (legacy path)
    const shared$ = this.participantService.getAcceptedParticipations(userId!).pipe(
      switchMap((participations: TripParticipant[]) => {
        if (!participations.length) return of([] as Trip[]);
        const tripIds = [...new Set(participations.map(p => p.tripId))];
        return combineLatest(
          tripIds.map(id =>
            this.run(() =>
              docData(doc(this.firestore, 'trips', id), { idField: 'id' }) as Observable<Trip>
            )
          )
        );
      })
    );

    return combineLatest([own$, collab$, shared$]).pipe(
      map(([own, collab, shared]) => {
        const ownIds = new Set(own.map(t => t.id));
        const collabFiltered = collab.filter(t => t && !ownIds.has(t.id));
        const collabIds = new Set(collabFiltered.map(t => t.id));
        const sharedFiltered = shared.filter(t => t && !ownIds.has(t.id) && !collabIds.has(t.id));
        const all = [...own, ...collabFiltered, ...sharedFiltered];
        return all.sort((a, b) => b.startDate.seconds - a.startDate.seconds);
      })
    );
  }

  getTrip(id: string): Observable<Trip> {
    return this.run(() =>
      docData(doc(this.firestore, 'trips', id), { idField: 'id' }) as Observable<Trip>
    );
  }

  createTrip(trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'userId'>) {
    return this.run(() => {
      const userId = this.auth.currentUser!.uid;
      return addDoc(collection(this.firestore, 'trips'), {
        ...trip,
        userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  updateTrip(id: string, changes: Partial<Trip>) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'trips', id), {
        ...changes,
        updatedAt: serverTimestamp(),
      })
    );
  }

  deleteTrip(id: string) {
    return this.run(() => deleteDoc(doc(this.firestore, 'trips', id)));
  }

  /** Look up a registered user by email and add them as a collaborator on the trip. */
  async inviteCollaborator(tripId: string, email: string): Promise<{ success: boolean; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const usersRef = collection(this.firestore, 'users');
    const q = query(usersRef, where('email', '==', normalizedEmail));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { success: false, message: 'No account found with that email' };
    }

    const userDoc = snapshot.docs[0];
    const uid = userDoc.id;

    await updateDoc(doc(this.firestore, 'trips', tripId), {
      collaboratorIds: arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });

    const profile = userDoc.data() as { displayName?: string };
    const name = profile.displayName || normalizedEmail;
    return { success: true, message: `${name} added as collaborator` };
  }

  /** Remove a collaborator from the trip by UID. */
  async removeCollaborator(tripId: string, uid: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'trips', tripId), {
      collaboratorIds: arrayRemove(uid),
      updatedAt: serverTimestamp(),
    });
  }

  /** Generate (or return existing) an invite token for a trip. */
  async generateInviteToken(tripId: string): Promise<string> {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(18)))
      .map(b => b.toString(36).padStart(2, '0')).join('');
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        inviteToken: token,
        updatedAt: serverTimestamp(),
      })
    );
    return token;
  }

  /** Accept an invite: look up trip by token, add current user as collaborator. */
  async acceptInvite(token: string): Promise<{ tripId: string; tripName: string; alreadyMember: boolean } | null> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return null;
    const q = query(
      collection(this.firestore, 'trips'),
      where('inviteToken', '==', token)
    );
    const snap = await this.run(() => getDocs(q));
    if (snap.empty) return null;
    const tripDoc = snap.docs[0];
    const trip = tripDoc.data() as Trip;
    const alreadyMember = trip.userId === uid || (trip.collaboratorIds ?? []).includes(uid);
    if (!alreadyMember) {
      await this.run(() =>
        updateDoc(tripDoc.ref, {
          collaboratorIds: arrayUnion(uid),
          updatedAt: serverTimestamp(),
        })
      );
    }
    return { tripId: tripDoc.id, tripName: trip.name, alreadyMember };
  }
}
