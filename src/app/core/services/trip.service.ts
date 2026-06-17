import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc, docData, getDoc,
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

  /** Generate an invite token and return the full shareable slug ({tripId}.{random}). */
  async generateInviteToken(tripId: string): Promise<string> {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map(b => b.toString(36).padStart(2, '0')).join('');
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        inviteToken: random,
        updatedAt: serverTimestamp(),
      })
    );
    return `${tripId}.${random}`;
  }

  /** Remove yourself from a trip's collaboratorIds (for non-owners). */
  async leaveTrip(tripId: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        collaboratorIds: arrayRemove(uid),
        updatedAt: serverTimestamp(),
      })
    );
  }

  /** Transfer trip ownership to another collaborator. Old owner becomes a collaborator. */
  async transferOwnership(tripId: string, newOwnerUid: string): Promise<void> {
    const currentUid = this.auth.currentUser!.uid;
    const tripRef = doc(this.firestore, 'trips', tripId);
    const tripSnap = await this.run(() => getDoc(tripRef));
    const trip = tripSnap.data() as Trip;
    const existing = trip.collaboratorIds ?? [];
    // New owner leaves collaborators; old owner joins collaborators (dedupe)
    const newCollaboratorIds = [
      ...existing.filter(id => id !== newOwnerUid),
      currentUid,
    ].filter((id, i, arr) => arr.indexOf(id) === i);
    await this.run(() =>
      updateDoc(tripRef, {
        userId: newOwnerUid,
        collaboratorIds: newCollaboratorIds,
        updatedAt: serverTimestamp(),
      })
    );
  }

  /** Accept an invite: token is {tripId}.{random}. Uses getDoc — no query needed. */
  async acceptInvite(slug: string): Promise<{ tripId: string; tripName: string; alreadyMember: boolean } | null> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return null;
    const dot = slug.indexOf('.');
    if (dot === -1) return null;
    const tripId = slug.slice(0, dot);
    const random = slug.slice(dot + 1);
    const tripRef = doc(this.firestore, 'trips', tripId);
    const tripSnap = await this.run(() => getDoc(tripRef));
    if (!tripSnap.exists()) return null;
    const trip = tripSnap.data() as Trip;
    if (trip.inviteToken !== random) return null;
    const alreadyMember = trip.userId === uid || (trip.collaboratorIds ?? []).includes(uid);
    if (!alreadyMember) {
      await this.run(() =>
        updateDoc(tripRef, {
          collaboratorIds: arrayUnion(uid),
          updatedAt: serverTimestamp(),
        })
      );
    }
    return { tripId, tripName: trip.name, alreadyMember };
  }
}
