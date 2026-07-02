import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AsyncPipe, DatePipe, TitleCasePipe, CurrencyPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TripService } from '../../core/services/trip.service';
import { ParticipantService } from '../../core/services/participant.service';
import { AuthService } from '../../core/services/auth.service';
import { Trip } from '../../core/models/trip.model';
import { TripFormDialogComponent } from './trip-form-dialog/trip-form-dialog.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { from, of } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';
import { localDayNum, utcDayNum, daysUntilCalendar } from '../../core/util/trip-date.util';

@Component({
  selector: 'app-trips',
  standalone: true,
  imports: [
    AsyncPipe, DatePipe, TitleCasePipe, CurrencyPipe,
    MatCardModule, MatButtonModule, MatIconModule,
    MatMenuModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './trips.component.html',
  styleUrl: './trips.component.scss',
})
export class TripsComponent implements OnInit {
  private tripService = inject(TripService);
  private participantService = inject(ParticipantService);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  readonly currentUserId = this.auth.currentUser?.uid ?? '';
  readonly currentUserEmail = this.auth.currentUser?.email ?? '';

  trips$ = this.tripService.getTrips().pipe(
    map(trips => this.sortTrips(trips)),
    catchError(() => of([])),
  );

  /**
   * Orders trips so the most relevant come first: ongoing, then upcoming
   * (soonest departure first), then past (most recent first).
   */
  private sortTrips(trips: Trip[]): Trip[] {
    const rank: Record<'ongoing' | 'upcoming' | 'past', number> = { ongoing: 0, upcoming: 1, past: 2 };
    return [...trips].sort((a, b) => {
      const sa = this.tripStatus(a);
      const sb = this.tripStatus(b);
      if (rank[sa] !== rank[sb]) return rank[sa] - rank[sb];
      const ta = a.startDate.toDate().getTime();
      const tb = b.startDate.toDate().getTime();
      // upcoming/ongoing: soonest first; past: most recently finished first
      return sa === 'past' ? tb - ta : ta - tb;
    });
  }

  ngOnInit() {
    // Auto-accept any pending invites for this user's email
    if (this.currentUserEmail) {
      this.participantService
        .getPendingInvitesByEmail(this.currentUserEmail)
        .pipe(take(1))
        .subscribe(pending => {
          pending.forEach(p => {
            from(this.participantService.acceptInvite(p.id!, this.currentUserId))
              .subscribe();
          });
          if (pending.length > 0) {
            this.snackBar.open(
              `You've been added to ${pending.length} trip${pending.length > 1 ? 's' : ''}!`,
              undefined,
              { duration: 4000 }
            );
          }
        });
    }
  }

  isOwned(trip: Trip): boolean {
    return trip.userId === this.currentUserId;
  }

  private readonly tripDialogConfig = {
    width: '560px', maxWidth: '96vw', maxHeight: '92vh', panelClass: 'trip-dialog',
  };

  openNewTrip() {
    this.dialog.open(TripFormDialogComponent, { data: {}, ...this.tripDialogConfig });
  }

  openEditTrip(trip: Trip, event: Event) {
    event.stopPropagation();
    this.dialog.open(TripFormDialogComponent, { data: { trip }, ...this.tripDialogConfig });
  }

  deleteTrip(trip: Trip, event: Event) {
    event.stopPropagation();
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Trip',
        message: `Are you sure you want to delete "${trip.name}"? All data will be lost.`,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.tripService.deleteTrip(trip.id!)).subscribe(() =>
          this.snackBar.open('Trip deleted', undefined, { duration: 2500 })
        );
      }
    });
  }

  leaveTrip(trip: Trip, event: Event) {
    event.stopPropagation();
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Leave Trip',
        message: `Leave "${trip.name}"? It will be removed from your trips list.`,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;

      // If the user is in collaboratorIds, remove themselves that way
      if (trip.collaboratorIds?.includes(this.currentUserId)) {
        from(this.tripService.removeCollaborator(trip.id!, this.currentUserId)).subscribe(() =>
          this.snackBar.open('You have left the trip', undefined, { duration: 2500 })
        );
        return;
      }

      // Otherwise remove via participant record (legacy path)
      this.participantService.getParticipants(trip.id!)
        .pipe(take(1))
        .subscribe(participants => {
          const mine = participants.find(p => p.userId === this.currentUserId);
          if (mine) {
            from(this.participantService.deleteParticipant(mine.id!)).subscribe(() =>
              this.snackBar.open('You have left the trip', undefined, { duration: 2500 })
            );
          }
        });
    });
  }

  /** True if the current user is a named collaborator (not owner) on this trip */
  isCollaborator(trip: Trip): boolean {
    return !this.isOwned(trip) && (trip.collaboratorIds?.includes(this.currentUserId) ?? false);
  }

  openTrip(id: string) {
    this.router.navigate(['/trips', id]);
  }

  tripDuration(trip: Trip): number {
    const ms = trip.endDate.toDate().getTime() - trip.startDate.toDate().getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1;
  }

  tripStatus(trip: Trip): 'upcoming' | 'ongoing' | 'past' {
    // Compare calendar days (not instants) so a trip is "ongoing" for the whole
    // of its first and last day in the viewer's timezone.
    const today = localDayNum(new Date());
    const start = utcDayNum(trip.startDate.toDate());
    const end = utcDayNum(trip.endDate.toDate());
    if (today < start) return 'upcoming';
    if (today > end) return 'past';
    return 'ongoing';
  }

  /**
   * Friendly countdown for FUTURE trips only.
   * Returns null if the trip is in progress or has ended.
   * Days are counted between local-midnight boundaries so partial
   * days don't skew the result.
   */
  countdownLabel(trip: Trip): string | null {
    // Only show for upcoming trips.
    if (this.tripStatus(trip) !== 'upcoming') return null;

    const days = daysUntilCalendar(trip.startDate.toDate());

    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days to go`;
  }
}
