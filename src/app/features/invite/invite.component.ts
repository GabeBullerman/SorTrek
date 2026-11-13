import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Auth } from '@angular/fire/auth';
import { TripService } from '../../core/services/trip.service';

const PENDING_INVITE_KEY = 'pendingInviteToken';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-invite',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatIconModule, MatButtonModule],
  template: `
    <div class="invite-page">
      @if (state() === 'loading' || state() === 'redirecting') {
        <mat-spinner diameter="48"></mat-spinner>
        <p>{{ state() === 'redirecting' ? 'Taking you to the trip...' : 'Joining trip...' }}</p>
      } @else if (state() === 'success') {
        <mat-icon class="invite-icon success">check_circle</mat-icon>
        <h2>You're in!</h2>
        <p>Added to <strong>{{ tripName() }}</strong>. Taking you there...</p>
      } @else if (state() === 'invalid') {
        <mat-icon class="invite-icon error">link_off</mat-icon>
        <h2>Invalid invite link</h2>
        <p>This link may have expired or been revoked.</p>
        <button mat-flat-button color="primary" (click)="router.navigate(['/trips'])">Go to My Trips</button>
      }
    </div>
  `,
  styles: [`
    .invite-page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: var(--st-gradient-auth);
      color: white;
      text-align: center;
      padding: 24px;

      p { margin: 0; opacity: 0.85; font-size: 1rem; }
      h2 { margin: 0; font-size: 1.5rem; font-weight: 700; }
      strong { opacity: 1; }
    }

    .invite-icon {
      font-size: 56px; width: 56px; height: 56px;
      &.success { color: #a5d6a7; }
      &.error   { color: #ef9a9a; }
    }
  `],
})
export class InviteComponent implements OnInit {
  readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private tripService = inject(TripService);
  private firebaseAuth = inject(Auth);
  private snackBar = inject(MatSnackBar);

  readonly state = signal<'loading' | 'success' | 'redirecting' | 'invalid'>('loading');
  readonly tripName = signal('');
  readonly tripId = signal('');

  async ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';

    // authStateReady() resolves once Firebase has finished restoring the persisted
    // session -- auth.currentUser is null until then even if the user is signed in.
    await this.firebaseAuth.authStateReady();
    const user = this.firebaseAuth.currentUser;

    if (!user) {
      localStorage.setItem(PENDING_INVITE_KEY, token);
      this.router.navigate(['/auth/login']);
      return;
    }

    await this.processInvite(token);
  }

  async processInvite(token: string) {
    try {
      const result = await this.tripService.acceptInvite(token);
      if (!result) {
        this.state.set('invalid');
        return;
      }
      this.tripId.set(result.tripId);
      this.tripName.set(result.tripName);

      if (result.alreadyMember) {
        this.state.set('redirecting');
        this.snackBar.open(`You're already a member of ${result.tripName}`, undefined, { duration: 4000 });
        this.router.navigate(['/trips', result.tripId]);
      } else {
        this.state.set('success');
        setTimeout(() => {
          this.router.navigate(['/trips', result.tripId]);
          this.snackBar.open(`Welcome to ${result.tripName}!`, undefined, { duration: 4000 });
        }, 1500);
      }
    } catch (err) {
      console.error('[InviteComponent] processInvite error:', err);
      this.state.set('invalid');
    }
  }
}

export const PENDING_INVITE_KEY_EXPORT = PENDING_INVITE_KEY;
