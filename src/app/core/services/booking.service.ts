import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, updateDoc, deleteDoc, query, where, serverTimestamp, limit,
} from '@angular/fire/firestore';
import {
  Storage, ref, uploadBytes, getDownloadURL, deleteObject,
} from '@angular/fire/storage';
import { Observable } from 'rxjs';
import { Booking, BookingAttachment } from '../models/booking.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class BookingService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private auth = inject(AuthService);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getBookings(tripId: string): Observable<Booking[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'bookings'),
        where('tripId', '==', tripId),
        limit(300)
      );
      return collectionData(q, { idField: 'id' }) as Observable<Booking[]>;
    });
  }

  createBooking(booking: Omit<Booking, 'id' | 'createdAt'>) {
    return this.run(() =>
      addDoc(collection(this.firestore, 'bookings'), {
        ...stripUndefined(booking),
        createdAt: serverTimestamp(),
      })
    );
  }

  updateBooking(id: string, changes: Partial<Booking>) {
    // If the departure/check-in time changed, re-arm the check-in reminder so
    // the cron sends a fresh one for the new time.
    const next: Partial<Booking> = { ...changes };
    if (Object.prototype.hasOwnProperty.call(changes, 'checkIn')) {
      next.checkInReminderSent = false;
    }
    return this.run(() =>
      updateDoc(doc(this.firestore, 'bookings', id), stripUndefined(next))
    );
  }

  deleteBooking(id: string) {
    return this.run(() => deleteDoc(doc(this.firestore, 'bookings', id)));
  }

  /** Upload a file attachment to Storage and return its metadata. */
  async uploadAttachment(tripId: string, file: File): Promise<BookingAttachment> {
    const uid = this.auth.currentUser!.uid;
    const storagePath = `documents/${uid}/${tripId}/${Date.now()}_${file.name}`;
    const storageRef = ref(this.storage, storagePath);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return {
      name: file.name,
      url,
      storagePath,
      fileType: file.type,
      fileSize: file.size,
    };
  }

  /** Delete an attachment file from Storage; swallow errors (e.g. already gone). */
  async deleteAttachment(storagePath: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, storagePath));
    } catch {
      /* ignore — best-effort cleanup */
    }
  }
}

/**
 * Firestore rejects `undefined` field values (ignoreUndefinedProperties is not
 * enabled), so drop any top-level keys whose value is undefined before writing.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
