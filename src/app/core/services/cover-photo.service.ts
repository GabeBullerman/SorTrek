import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { firstValueFrom } from 'rxjs';
import imageCompression from 'browser-image-compression';
import { AuthService } from './auth.service';

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.3,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
};

/**
 * Persists a trip cover image to Firebase Storage so it never expires.
 *
 * Google Places photo URLs (from PlacePhoto.getUrl()) are signed and short-lived,
 * so storing them directly means the cover breaks after a while. This service
 * downloads the image once (via the /api/place-photo proxy to dodge browser CORS),
 * compresses it, uploads a permanent copy, and returns its stable download URL.
 */
@Injectable({ providedIn: 'root' })
export class CoverPhotoService {
  private http = inject(HttpClient);
  private storage = inject(Storage);
  private auth = inject(AuthService);

  /** True if the URL is already a permanent Storage URL (nothing to do). */
  isPersisted(url: string | null | undefined): boolean {
    if (!url) return false;
    return url.includes('firebasestorage.googleapis.com')
      || url.includes('storage.googleapis.com')
      || url.startsWith('data:');
  }

  /**
   * Download the Google photo and store a permanent copy. Returns the new
   * download URL, or the original URL if persistence is unnecessary/fails.
   */
  async persist(googlePhotoUrl: string): Promise<string> {
    if (this.isPersisted(googlePhotoUrl)) return googlePhotoUrl;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return googlePhotoUrl;

    // 1. Fetch the bytes server-side (avoids CORS on Google's image hosts).
    const res = await firstValueFrom(
      this.http.post<{ dataUrl?: string; error?: string }>('/api/place-photo', { url: googlePhotoUrl })
    );
    if (!res?.dataUrl) throw new Error(res?.error ?? 'Could not download cover image');

    // 2. Compress.
    const blob = await (await fetch(res.dataUrl)).blob();
    const file = new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' });
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);

    // 3. Upload to the existing coverPhotos/{uid}/** path and return its URL.
    const id = crypto.randomUUID();
    const storageRef = ref(this.storage, `coverPhotos/${uid}/${id}.jpg`);
    await uploadBytes(storageRef, compressed, { contentType: 'image/jpeg' });
    return getDownloadURL(storageRef);
  }
}
