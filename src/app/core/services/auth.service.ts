import { Injectable, inject } from '@angular/core';
import {
  Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, user,
  updateProfile, signInWithPopup, GoogleAuthProvider, getAdditionalUserInfo,
  EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, updatePassword,
} from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, terminate, clearIndexedDbPersistence } from '@angular/fire/firestore';
import { Timestamp } from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  readonly currentUser$ = user(this.auth);

  login(email: string, password: string) {
    return from(signInWithEmailAndPassword(this.auth, email, password));
  }

  register(email: string, password: string, displayName: string) {
    return from(
      createUserWithEmailAndPassword(this.auth, email, password).then(cred =>
        updateProfile(cred.user, { displayName }).then(() => cred)
      )
    );
  }

  loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    return from(
      signInWithPopup(this.auth, provider).then(async cred => {
        const info = getAdditionalUserInfo(cred);
        if (info?.isNewUser) {
          const profileRef = doc(this.firestore, 'users', cred.user.uid);
          const existing = await getDoc(profileRef);
          if (!existing.exists()) {
            await setDoc(profileRef, {
              uid: cred.user.uid,
              displayName: cred.user.displayName ?? 'Traveller',
              email: cred.user.email ?? '',
              photoURL: cred.user.photoURL ?? null,
              country: 'United States',
              homeCurrency: 'USD',
              createdAt: Timestamp.now(),
            });
          }
        }
        return cred;
      })
    );
  }

  /**
   * Full logout: revoke the Firebase session (clears its IndexedDB auth token),
   * wipe app-persisted state, and clear the offline Firestore cache so none of
   * the previous user's data remains on the device. Best-effort on each step so
   * a single failure can't block sign-out. The caller should do a FULL page
   * reload afterwards (window.location) — Firestore is terminated here.
   */
  async logout(): Promise<void> {
    try { await signOut(this.auth); } catch { /* ignore */ }

    // App-persisted client state.
    try {
      localStorage.removeItem('pendingInviteToken');
      sessionStorage.clear();
    } catch { /* storage may be unavailable */ }

    // Offline Firestore cache (device-level; not per-user) — terminate then clear.
    try {
      await terminate(this.firestore);
      await clearIndexedDbPersistence(this.firestore);
    } catch { /* multiple tabs / already cleared — best-effort */ }
  }

  get currentUser() {
    return this.auth.currentUser;
  }

  /** 'password' for email/password accounts, 'google.com' for Google sign-in. */
  get primaryProvider(): string | null {
    return this.auth.currentUser?.providerData[0]?.providerId ?? null;
  }

  /**
   * Prove the user is really present before a sensitive action (password
   * change, account deletion). Email accounts re-enter their password;
   * Google accounts confirm through the Google popup. Refreshes auth_time,
   * which the delete-account endpoint checks server-side.
   */
  async reauthenticate(password?: string): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) throw new Error('Not signed in');
    if (this.primaryProvider === 'password') {
      if (!password) throw new Error('Password required');
      const cred = EmailAuthProvider.credential(u.email!, password);
      await reauthenticateWithCredential(u, cred);
    } else {
      await reauthenticateWithPopup(u, new GoogleAuthProvider());
    }
  }

  /** Change password (email/password accounts only). Verifies the current one first. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.reauthenticate(currentPassword);
    await updatePassword(this.auth.currentUser!, newPassword);
  }
}
