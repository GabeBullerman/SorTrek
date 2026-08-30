import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { Auth } from '@angular/fire/auth';
import { environment } from '../../../environments/environment';
import { from, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private messaging = inject(Messaging, { optional: true });

  get isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  get permission(): NotificationPermission {
    return this.isSupported ? Notification.permission : 'denied';
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported) return false;
    const result = await Notification.requestPermission();
    if (result === 'granted' && this.messaging) {
      await this.saveFcmToken();
    }
    return result === 'granted';
  }

  private async saveFcmToken() {
    if (!this.messaging) return;
    try {
      const token = await getToken(this.messaging, {
        vapidKey: environment.vapidKey,
        serviceWorkerRegistration: await navigator.serviceWorker.ready,
      });
      const uid = this.auth.currentUser?.uid;
      if (uid && token) {
        // Stored in a private subcollection (owner-only readable) rather than the
        // world-readable profile doc, so push tokens aren't exposed to other users.
        await setDoc(doc(this.firestore, 'users', uid, 'private', 'push'), { fcmToken: token }, { merge: true });
      }
    } catch (e) {
      console.warn('FCM token error:', e);
    }
  }

  /** Send a local browser notification immediately (works when app is open). */
  send(title: string, body: string, options: NotificationOptions = {}) {
    if (this.permission !== 'granted') return;
    new Notification(title, {
      body,
      // Shown as-is, so it needs an opaque mark — a white-on-transparent logo
      // disappears against a light notification shade.
      icon: '/icon-192.png',
      // Rendered as an alpha silhouette, so the transparent logo is right here.
      badge: '/ClearLogoWhiteCircle.png',
      ...options,
    });
  }

  /** Schedule a local notification at a future time (ms from now). */
  schedule(delayMs: number, title: string, body: string) {
    if (this.permission !== 'granted') return;
    setTimeout(() => this.send(title, body), delayMs);
  }

  /** Listen for foreground FCM messages. */
  onForegroundMessage(): Observable<any> {
    if (!this.messaging) return of(null);
    return new Observable(obs => onMessage(this.messaging!, payload => obs.next(payload)));
  }
}
