import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc, docData, getDoc,
  addDoc, updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, getDocs, arrayUnion, arrayRemove,
} from '@angular/fire/firestore';
import { HttpClient } from '@angular/common/http';
import { Observable, combineLatest, of, firstValueFrom } from 'rxjs';
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
  private http = inject(HttpClient);

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

  /** Add a registered user to the trip by email.
   *
   *  Done server-side: resolving an email to an account needs a query over
   *  `users`, and allowing that from the client meant any signed-in account
   *  could list every user's email address. The endpoint also checks the
   *  caller owns the trip, which Firestore rules alone can't express for an
   *  arrayUnion on someone else's document. */
  async inviteCollaborator(tripId: string, email: string): Promise<{ success: boolean; message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; message: string }>('/api/accept-invite', {
          action: 'invite', tripId, email: normalizedEmail,
        })
      );
      return { success: !!res?.success, message: res?.message ?? 'Could not add that person' };
    } catch (err) {
      const message = (err as { error?: { error?: string } })?.error?.error;
      return { success: false, message: message ?? 'Could not add that person to the trip' };
    }
  }

  /** Grant trip access to an email that may not have an account yet. */
  async addCollaboratorEmail(tripId: string, email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    await updateDoc(doc(this.firestore, 'trips', tripId), {
      collaboratorEmails: arrayUnion(normalizedEmail),
      updatedAt: serverTimestamp(),
    });
  }

  /** Remove a collaborator from the trip by UID (and optionally their email). */
  async removeCollaborator(tripId: string, uid: string, email?: string): Promise<void> {
    const changes: Record<string, unknown> = {
      collaboratorIds: arrayRemove(uid),
      updatedAt: serverTimestamp(),
    };
    if (email) changes['collaboratorEmails'] = arrayRemove(email.trim().toLowerCase());
    await updateDoc(doc(this.firestore, 'trips', tripId), changes);
  }

  /** Revoke an invited email's access (used when removing a not-yet-registered invitee). */
  async removeCollaboratorEmail(tripId: string, email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    await updateDoc(doc(this.firestore, 'trips', tripId), {
      collaboratorEmails: arrayRemove(normalizedEmail),
      updatedAt: serverTimestamp(),
    });
  }

  /** Promote a collaborator to co-owner (full owner privileges). Also ensures
   *  they're in collaboratorIds so the trip stays in their list. */
  async addCoOwner(tripId: string, uid: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'trips', tripId), {
      ownerIds: arrayUnion(uid),
      collaboratorIds: arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });
  }

  /** Demote a co-owner back to a regular collaborator (keeps trip access). */
  async removeCoOwner(tripId: string, uid: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'trips', tripId), {
      ownerIds: arrayRemove(uid),
      updatedAt: serverTimestamp(),
    });
  }

  /** Allow a collaborator to edit the schedule directly (no proposal needed). */
  async grantScheduleEdit(tripId: string, uid: string): Promise<void> {
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        scheduleEditorIds: arrayUnion(uid),
        updatedAt: serverTimestamp(),
      })
    );
  }

  /** Revoke a collaborator's direct schedule-edit rights (back to propose-only). */
  async revokeScheduleEdit(tripId: string, uid: string): Promise<void> {
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        scheduleEditorIds: arrayRemove(uid),
        updatedAt: serverTimestamp(),
      })
    );
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

  /** Turn on the read-only public link. Generates a URL-safe token the first
   *  time (reused on re-enable), flips shareEnabled on, and returns the token. */
  async enablePublicShare(tripId: string, existingToken?: string): Promise<string> {
    const token = existingToken || crypto.randomUUID().replace(/-/g, '');
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        shareToken: token,
        shareEnabled: true,
        updatedAt: serverTimestamp(),
      })
    );
    return token;
  }

  /** Rotate the public-share token — invalidates the existing link and keeps
   *  sharing enabled. Use if a shared link leaks. */
  async regeneratePublicShareToken(tripId: string): Promise<string> {
    const token = crypto.randomUUID().replace(/-/g, '');
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        shareToken: token,
        shareEnabled: true,
        updatedAt: serverTimestamp(),
      })
    );
    return token;
  }

  /** Turn off the public link. Keeps shareToken so re-enabling reuses the link. */
  async disablePublicShare(tripId: string): Promise<void> {
    await this.run(() =>
      updateDoc(doc(this.firestore, 'trips', tripId), {
        shareEnabled: false,
        updatedAt: serverTimestamp(),
      })
    );
  }

  /** Remove yourself from a trip's collaborator lists (for non-owners). */
  async leaveTrip(tripId: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const email = this.auth.currentUser?.email?.trim().toLowerCase();
    const changes: Record<string, unknown> = {
      collaboratorIds: arrayRemove(uid),
      updatedAt: serverTimestamp(),
    };
    if (email) changes['collaboratorEmails'] = arrayRemove(email);
    await this.run(() => updateDoc(doc(this.firestore, 'trips', tripId), changes));
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

  /**
   * Accept an invite (slug = {tripId}.{random}). Handled server-side by the
   * Admin SDK so the client never needs to read another user's trip — the
   * api-auth interceptor attaches the caller's ID token, which the endpoint
   * verifies before adding them as a collaborator.
   */
  async acceptInvite(slug: string): Promise<{ tripId: string; tripName: string; alreadyMember: boolean } | null> {
    if (!this.auth.currentUser?.uid) return null;
    try {
      return await firstValueFrom(
        this.http.post<{ tripId: string; tripName: string; alreadyMember: boolean }>(
          '/api/accept-invite', { slug },
        )
      );
    } catch {
      return null;
    }
  }
}
