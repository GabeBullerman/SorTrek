import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, updateDoc, deleteDoc, query, where, serverTimestamp,
} from '@angular/fire/firestore';
import {
  Storage, ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from '@angular/fire/storage';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import imageCompression from 'browser-image-compression';
import { Photo } from '../models/photo.model';
import { AuthService } from './auth.service';

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

@Injectable({ providedIn: 'root' })
export class PhotoService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private auth = inject(AuthService);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  /** Every photo on the trip, newest first.
   *
   *  The sort is done client-side on purpose. A Firestore `orderBy` silently
   *  drops any document that is missing the ordered field, so photos whose
   *  `uploadedAt` hasn't resolved yet (a `serverTimestamp()` is null in the
   *  local echo until the write lands) or that were written before the field
   *  existed never showed up in the album at all. Filtering on `tripId` alone
   *  returns the whole album; we order it in memory instead. */
  getPhotos(tripId: string): Observable<Photo[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'photos'),
        where('tripId', '==', tripId)
      );
      return (collectionData(q, { idField: 'id' }) as Observable<Photo[]>).pipe(
        map(photos => [...photos].sort((a, b) => this.uploadedMillis(b) - this.uploadedMillis(a)))
      );
    });
  }

  /** Millis for sorting. A pending server timestamp sorts to the top — it was
   *  just uploaded on this device, so "newest first" is the honest position. */
  private uploadedMillis(photo: Photo): number {
    const at = photo.uploadedAt as { toMillis?: () => number } | undefined | null;
    return at?.toMillis ? at.toMillis() : Number.MAX_SAFE_INTEGER;
  }

  /** Upload progress, and on the final emission the id of the created photo so
   *  callers can act on the batch they just added (captioning it, say). */
  uploadPhoto(tripId: string, file: File, caption?: string): Observable<UploadEvent> {
    const userId = this.auth.currentUser!.uid;

    return new Observable(observer => {
      observer.next({ percent: 0 });

      imageCompression(file, COMPRESSION_OPTIONS)
        .then(compressed => {
          const storagePath = `photos/${userId}/${tripId}/${Date.now()}_${file.name}`;
          const storageRef = ref(this.storage, storagePath);
          const uploadTask = uploadBytesResumable(storageRef, compressed);

          uploadTask.on(
            'state_changed',
            snapshot => observer.next({
              percent: (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
            }),
            err => observer.error(err),
            async () => {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const uploaderName = this.auth.currentUser?.displayName ?? 'Unknown';
              const ref = await this.run(() =>
                addDoc(collection(this.firestore, 'photos'), {
                  tripId, userId, uploaderName, url, storagePath,
                  caption: caption ?? '',
                  uploadedAt: serverTimestamp(),
                })
              );
              observer.next({ percent: 100, id: ref.id });
              observer.complete();
            }
          );
        })
        .catch(err => observer.error(err));
    });
  }

  updateCaption(id: string, caption: string) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'photos', id), { caption })
    );
  }

  async deletePhoto(photo: Photo) {
    await deleteObject(ref(this.storage, photo.storagePath)).catch(() => { /* already gone */ });
    return this.run(() => deleteDoc(doc(this.firestore, 'photos', photo.id!)));
  }

  /** Remove a Firestore doc whose underlying Storage object is gone. Only ever
   *  called from an explicit user action on a tile that failed to load — an
   *  image error on its own is not proof the file is missing (an expired token,
   *  a flaky connection or a throttled batch load all look identical), and
   *  deleting on one is how photos vanished from shared albums. */
  async purgeOrphanDoc(photoId: string): Promise<void> {
    try {
      await this.run(() => deleteDoc(doc(this.firestore, 'photos', photoId)));
    } catch { /* ignore */ }
  }

  /** A sensible file name for saving: the original upload name, with the
   *  `Date.now()_` prefix the storage path carries stripped back off. */
  fileNameFor(photo: Photo): string {
    const base = (photo.storagePath ?? '').split('/').pop() ?? '';
    const original = base.replace(/^\d+_/, '');
    if (original) return original;
    return `${(photo.caption || 'photo').replace(/[^\w.-]+/g, '-').slice(0, 40)}.jpg`;
  }

  /** Bytes we've already fetched, keyed by photo id. Saving from this cache is
   *  what makes the native share sheet work: iOS only honours `navigator.share`
   *  while the user's tap is still "live", so awaiting a download first loses
   *  the gesture. We prefetch on selection and share straight from here. */
  private fileCache = new Map<string, File>();
  private inFlight = new Map<string, Promise<File | null>>();

  /** Warm the cache for a photo the user is likely to save next. */
  prefetch(photo: Photo): void {
    void this.fileFor(photo);
  }

  /** Drop cached bytes (a deleted photo, or a memory-conscious teardown). */
  forgetCached(photoId: string): void {
    this.fileCache.delete(photoId);
    this.inFlight.delete(photoId);
  }

  private cachedFile(photo: Photo): File | null {
    return photo.id ? this.fileCache.get(photo.id) ?? null : null;
  }

  /** Fetch (once) and cache the real bytes for a photo. */
  private fileFor(photo: Photo, nameOverride?: string): Promise<File | null> {
    const key = photo.id ?? photo.storagePath;
    const cached = this.fileCache.get(key);
    if (cached) return Promise.resolve(cached);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = this.downloadFile(photo, nameOverride ?? this.fileNameFor(photo))
      .then(file => {
        if (file) this.fileCache.set(key, file);
        return file;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
  }

  /** Get the image bytes. Goes through our own `/api/photos` first: it
   *  is same-origin, so there's no bucket CORS to configure and the browser
   *  will actually save the result instead of opening the image in a new tab.
   *  Falls back to the Storage URL directly if the endpoint isn't available. */
  private async downloadFile(photo: Photo, name: string): Promise<File | null> {
    if (photo.id) {
      try {
        const token = await this.auth.currentUser?.getIdToken();
        if (token) {
          const res = await fetch(`/api/photos?action=download&id=${encodeURIComponent(photo.id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const blob = await res.blob();
            return new File([blob], name, { type: blob.type || 'image/jpeg' });
          }
        }
      } catch { /* fall through to the direct URL */ }
    }

    try {
      const res = await fetch(photo.url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    } catch {
      return null;
    }
  }

  /** Save one photo to the device. */
  async savePhoto(photo: Photo): Promise<void> {
    const name = this.fileNameFor(photo);

    // Cached already? Share synchronously so iOS still counts the user's tap.
    const ready = this.cachedFile(photo);
    if (ready && this.shareNow([ready])) return;

    const file = ready ?? await this.fileFor(photo, name);
    if (file) {
      if (await this.shareFiles([file])) return;
      this.downloadBlob(file, name);
      return;
    }
    this.openInNewTab(photo.url, name);
  }

  /** Save many photos at once — one share sheet for the batch where possible,
   *  otherwise staggered downloads. Resolves with how many were saved. */
  async savePhotos(photos: Photo[]): Promise<number> {
    if (photos.length === 1) {
      await this.savePhoto(photos[0]);
      return 1;
    }

    const named = photos.map(p => ({ photo: p, name: this.uniqueName(p, photos) }));

    // Everything already prefetched → share immediately, gesture intact.
    const cached = named.map(n => this.cachedFile(n.photo));
    if (cached.every((f): f is File => !!f) && this.shareNow(cached as File[])) {
      return cached.length;
    }

    const files = await Promise.all(named.map(n => this.fileFor(n.photo, n.name)));
    const fetched = files.filter((f): f is File => !!f);

    if (fetched.length === named.length && await this.shareFiles(fetched)) {
      return fetched.length;
    }

    let saved = 0;
    for (let i = 0; i < named.length; i++) {
      const file = files[i];
      if (file) {
        this.downloadBlob(file, named[i].name);
      } else {
        this.openInNewTab(named[i].photo.url, named[i].name);
      }
      saved++;
      // Browsers drop downloads fired back-to-back in the same tick.
      if (i < named.length - 1) await new Promise(r => setTimeout(r, 350));
    }
    return saved;
  }

  /** Disambiguate duplicate original file names within one batch. */
  private uniqueName(photo: Photo, batch: Photo[]): string {
    const name = this.fileNameFor(photo);
    const clashes = batch.filter(p => this.fileNameFor(p) === name);
    if (clashes.length < 2) return name;
    const index = clashes.findIndex(p => p.id === photo.id);
    const dot = name.lastIndexOf('.');
    return dot > 0
      ? `${name.slice(0, dot)}-${index + 1}${name.slice(dot)}`
      : `${name}-${index + 1}`;
  }

  private shareTarget() {
    return navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
  }

  /** Fire the share sheet without awaiting anything first, so the browser still
   *  associates it with the tap. Returns whether the attempt was made. */
  private shareNow(files: File[]): boolean {
    const nav = this.shareTarget();
    if (!nav.share || !nav.canShare || !nav.canShare({ files })) return false;
    nav.share({ files, title: files.length === 1 ? files[0].name : 'Trip photos' })
      .catch(() => { /* dismissed, or the platform declined */ });
    return true;
  }

  private async shareFiles(files: File[]): Promise<boolean> {
    const nav = this.shareTarget();
    if (!nav.share || !nav.canShare || !nav.canShare({ files })) return false;
    try {
      await nav.share({ files, title: files.length === 1 ? files[0].name : 'Trip photos' });
      return true;
    } catch (err) {
      // The user dismissing the sheet still counts as handled; a gesture that
      // expired (NotAllowedError) should fall through to a download.
      return (err as DOMException)?.name === 'AbortError';
    }
  }

  private downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private openInNewTab(url: string, name: string): void {
    const a = window.document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }

  /** Ask the server to reconcile the album against Storage, restoring records
   *  for images that are still in the bucket but missing from the album. */
  async syncWithStorage(tripId: string): Promise<PhotoSyncResult> {
    const token = await this.auth.currentUser?.getIdToken();
    const res = await fetch('/api/photos?action=sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tripId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Sync failed (${res.status})`);
    return body as PhotoSyncResult;
  }
}

/** Emitted while a photo uploads; the last one carries the new photo's id. */
export interface UploadEvent {
  percent: number;
  id?: string;
}

/** What `/api/photos?action=sync` reports back. */
export interface PhotoSyncResult {
  /** Image files the trip actually has in Storage. */
  inStorage: number;
  /** Photo records the album held before the sync. */
  inAlbum: number;
  /** Records written back for files the album was missing. */
  restored: number;
  /** Files that couldn't be restored. */
  failed: number;
}
