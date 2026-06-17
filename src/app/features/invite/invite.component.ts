import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TripService } from '../../core/services/trip.service';
import { AuthService } from '../../core/services/auth.service';

const PENDING_INVITE_KEY = 'pendingInviteToken';

@Component({
  selector: 'app-invite',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatIconModule, MatButtonModule],
  template: `
    <div class="invite-page">
      @if (state === 'loading') {
        <mat-spinner diameter="48"></mat-spinner>
        <p>Joining trip…</p>
      } @else if (state === 'success') {
        <mat-icon class="invite-icon success">check_circle</mat-icon>
        <h2>You're in!</h2>
        <p>You've been added to <strong>{{ tripName }}</strong>.</p>
        <button mat-flat-button color="primary" (click)="goToTrip()">Open Trip</button>
      } @else if (state === 'already') {
        <mat-icon class="invite-icon info">group</mat-icon>
        <h2>Already a member</h2>
        <p>You're already part of <strong>{{ tripName }}</strong>.</p>
        <button mat-flat-button color="primary" (click)="goToTrip()">Open Trip</button>
      } @else if (state === 'invalid') {
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
      background: linear-gradient(135deg, #1a237e 0%, #303f9f 100%);
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
      &.info    { color: #90caf9; }
      &.error   { color: #ef9a9a; }
    }
  `],
})
export class InviteComponent implements OnInit {
  readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private tripService = inject(TripService);
  private auth = inject(AuthService);

  state: 'loading' | 'success' | 'already' | 'invalid' = 'loading';
  tripName = '';
  tripId = '';

  async ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    const user = this.auth.currentUser;

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
        this.state = 'invalid';
        return;
      }
      this.tripId = result.tripId;
      this.tripName = result.tripName;
      this.state = result.alreadyMember ? 'already' : 'success';
    } catch {
      this.state = 'invalid';
    }
  }

  goToTrip() {
    this.router.navigate(['/trips', this.tripId]);
  }
}

export const PENDING_INVITE_KEY_EXPORT = PENDING_INVITE_KEY;
