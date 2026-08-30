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

  uploadPhoto(tripId: string, file: File, caption?: string): Observable<number> {
    const userId = this.auth.currentUser!.uid;

    return new Observable(observer => {
      observer.next(0);

      imageCompression(file, COMPRESSION_OPTIONS)
        .then(compressed => {
          const storagePath = `photos/${userId}/${tripId}/${Date.now()}_${file.name}`;
          const storageRef = ref(this.storage, storagePath);
          const uploadTask = uploadBytesResumable(storageRef, compressed);

          uploadTask.on(
            'state_changed',
            snapshot => observer.next((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
            err => observer.error(err),
            async () => {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const uploaderName = this.auth.currentUser?.displayName ?? 'Unknown';
              await this.run(() =>
                addDoc(collection(this.firestore, 'photos'), {
                  tripId, userId, uploaderName, url, storagePath,
                  caption: caption ?? '',
                  uploadedAt: serverTimestamp(),
                })
              );
              observer.next(100);
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

  /** Save one photo to the device. Uses the native share sheet where the
   *  platform offers it (that is how you get "Save Image" on iOS/Android),
   *  otherwise a blob download, otherwise a plain link to the file. */
  async savePhoto(photo: Photo): Promise<void> {
    const name = this.fileNameFor(photo);
    const file = await this.toFile(photo, name);
    if (file && await this.shareFiles([file])) return;
    if (file) { this.downloadBlob(file, name); return; }
    this.openInNewTab(photo.url, name);
  }

  /** Save many photos at once. Tries a single share sheet for the whole batch
   *  first (one prompt instead of N), then falls back to staggered downloads.
   *  Resolves with how many actually made it to the device. */
  async savePhotos(photos: Photo[]): Promise<number> {
    if (photos.length === 1) {
      await this.savePhoto(photos[0]);
      return 1;
    }

    const named = photos.map(p => ({ photo: p, name: this.uniqueName(p, photos) }));
    const files = await Promise.all(named.map(n => this.toFile(n.photo, n.name)));
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

  /** Fetch the bytes so we can hand the browser a real file. Returns null when
   *  the download is blocked (Storage CORS not configured, offline, …) so the
   *  caller can fall back to a plain link. */
  private async toFile(photo: Photo, name: string): Promise<File | null> {
    try {
      const res = await fetch(photo.url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    } catch {
      return null;
    }
  }

  private async shareFiles(files: File[]): Promise<boolean> {
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (!nav.share || !nav.canShare || !nav.canShare({ files })) return false;
    try {
      await nav.share({ files, title: files.length === 1 ? files[0].name : 'Trip photos' });
      return true;
    } catch {
      // AbortError (user dismissed) or NotAllowedError (gesture expired) —
      // either way, fall through to the download path.
      return false;
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
}
