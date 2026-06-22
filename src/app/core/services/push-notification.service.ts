import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, doc, updateDoc } from '@angular/fire/firestore';
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
        await updateDoc(doc(this.firestore, 'users', uid), { fcmToken: token });
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
      icon: '/ClearLogoWhiteCircle.png',
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
