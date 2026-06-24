import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

/**
 * Reactive view of the current user's feature preferences (AI features and
 * suggestion/reminder notifications). Both default to ON when the profile
 * field is undefined, so existing users keep their current behavior until they
 * explicitly opt out. Components read the signals; the Profile page writes via
 * the setters (which persist to Firestore and update the signal optimistically).
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private auth = inject(AuthService);
  private userService = inject(UserService);

  readonly aiEnabled = signal(true);
  readonly remindersEnabled = signal(true);

  private uid = '';

  constructor() {
    this.auth.currentUser$.pipe(
      filter(u => !!u),
      switchMap(u => {
        this.uid = u!.uid;
        return this.userService.getProfile(u!.uid);
      }),
      takeUntilDestroyed(),
    ).subscribe(profile => {
      if (profile) {
        this.aiEnabled.set(profile.aiEnabled !== false);
        this.remindersEnabled.set(profile.remindersEnabled !== false);
      }
    });
  }

  setAiEnabled(on: boolean) {
    this.aiEnabled.set(on);
    if (this.uid) this.userService.updateProfile(this.uid, { aiEnabled: on });
  }

  setRemindersEnabled(on: boolean) {
    this.remindersEnabled.set(on);
    if (this.uid) this.userService.updateProfile(this.uid, { remindersEnabled: on });
  }
}
