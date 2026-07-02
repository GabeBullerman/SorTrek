import { Component, effect, ElementRef, inject, Input, OnInit, signal, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { APP_NAME } from '../../core/sortrek-title.strategy';
import { AsyncPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TripService } from '../../core/services/trip.service';
import { AuthService } from '../../core/services/auth.service';
import { CardReminderService } from '../../core/services/card-reminder.service';
import { PushNotificationService } from '../../core/services/push-notification.service';
import { UserPreferencesService } from '../../core/services/user-preferences.service';
import { Trip } from '../../core/models/trip.model';
import { TripFormDialogComponent } from '../trips/trip-form-dialog/trip-form-dialog.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ScheduleComponent } from './schedule/schedule.component';
import { BookingsComponent } from './bookings/bookings.component';
import { PhotosComponent } from './photos/photos.component';
import { CostsComponent } from './costs/costs.component';
import { OverviewComponent } from './overview/overview.component';
import { PeopleComponent } from './people/people.component';
import { PackingComponent } from './packing/packing.component';
import { AiAssistantComponent } from './ai-assistant/ai-assistant.component';
import { TransportComponent } from './transport/transport.component';
import { DocumentsComponent } from './documents/documents.component';
import { IdeasComponent } from './ideas/ideas.component';
import { from, take, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { localDayNum, utcDayNum } from '../../core/util/trip-date.util';

export interface TabDef {
  label: string;
  icon: string;
}

@Component({
  selector: 'app-trip-detail',
  standalone: true,
  imports: [
    AsyncPipe, DatePipe, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule, MatMenuModule, MatSlideToggleModule,
    // Tab components are referenced ONLY inside @defer blocks in the template,
    // so Angular code-splits each into its own lazy chunk automatically.
    ScheduleComponent, BookingsComponent, PhotosComponent, CostsComponent,
    OverviewComponent, PeopleComponent, PackingComponent, AiAssistantComponent,
    TransportComponent, DocumentsComponent, IdeasComponent,
  ],
  templateUrl: './trip-detail.component.html',
  styleUrl: './trip-detail.component.scss',
})
export class TripDetailComponent implements OnInit {
  @Input() id!: string;
  @ViewChild('tabNav') tabNavRef!: ElementRef<HTMLDivElement>;

  private tripService = inject(TripService);
  private auth = inject(AuthService);
  private cardReminderService = inject(CardReminderService);
  private pushNotificationService = inject(PushNotificationService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);
  private titleService = inject(Title);
  readonly prefs = inject(UserPreferencesService);

  constructor() {
    effect(() => {
      const tab = this.tabs[this.selectedTab()]?.label;
      this.titleService.setTitle(tab ? `${APP_NAME} | ${tab}` : APP_NAME);
    });

    // If AI features are turned off while the AI tab is open, fall back to Overview.
    effect(() => {
      if (!this.prefs.aiEnabled() && this.tabs[this.selectedTab()]?.label === 'AI') {
        this.selectedTab.set(0);
      }
    });
  }

  readonly currentUserId = this.auth.currentUser?.uid ?? '';
  isOwner(trip: Trip): boolean {
    return trip.userId === this.currentUserId || (trip.ownerIds ?? []).includes(this.currentUserId);
  }

  trip$!: ReturnType<TripService['getTrip']>;

  readonly selectedTab = signal(0);

  readonly tabs: TabDef[] = [
    { label: 'Overview',   icon: 'map' },
    { label: 'Schedule',   icon: 'event_note' },
    { label: 'Transport',  icon: 'directions_transit' },
    { label: 'Photos',     icon: 'photo_library' },
    { label: 'Costs',      icon: 'payments' },
    { label: 'Bookings',   icon: 'confirmation_number' },
    { label: 'People',     icon: 'group' },
    { label: 'Packing',    icon: 'luggage' },
    { label: 'Documents',  icon: 'folder_open' },
    { label: 'AI',         icon: 'auto_awesome' },
    { label: 'Ideas',      icon: 'lightbulb' },
  ];

  /** Tab indexes that fold into the "More" menu on narrow screens
   *  (Transport, Photos, People, Documents, AI, Ideas — the less-daily tabs). */
  private readonly overflowTabIdx = new Set([2, 3, 6, 8, 9, 10]);

  isOverflowTab(i: number): boolean {
    return this.overflowTabIdx.has(i);
  }

  /** True when the active tab lives in the More menu (so More shows as active). */
  overflowActive(): boolean {
    return this.overflowTabIdx.has(this.selectedTab());
  }

  ngOnInit() {
    // If the trip doesn't exist or the user isn't a member, the read is denied
    // by Firestore rules (IDOR-safe). Redirect out instead of hanging, and never
    // render another user's trip.
    this.trip$ = this.tripService.getTrip(this.id).pipe(
      catchError(() => {
        this.snackBar.open('That trip is not available.', undefined, { duration: 3000 });
        this.router.navigate(['/trips']);
        return of(null as unknown as Trip);
      })
    );

    // Restore tab from URL query param (e.g. ?tab=people)
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam) {
      const idx = this.tabs.findIndex(t => t.label.toLowerCase() === tabParam.toLowerCase());
      if (idx !== -1) this.selectedTab.set(idx);
    }

    this.trip$.pipe(take(1)).subscribe(trip => {
      if (!trip) return;

      // Mid-trip, open straight onto today's schedule (unless a specific tab
      // was linked). The schedule itself then focuses today's day.
      if (!tabParam && this.isOngoing(trip)) {
        this.selectedTab.set(1);
      }

      // Schedule a departure-reminder notification on first load (no-op if timing
      // is outside window). Skipped when reminders are off in the profile.
      if (this.prefs.remindersEnabled()) {
        this.cardReminderService.scheduleNotification(trip, this.pushNotificationService);
      }
    });
  }

  selectTab(index: number) {
    this.selectedTab.set(index);
    const slug = this.tabs[index].label.toLowerCase();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: slug },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    // Scroll active tab into centre of the nav bar (helps on mobile)
    setTimeout(() => {
      const nav = this.tabNavRef?.nativeElement;
      const btn = nav?.querySelector<HTMLElement>('.tab-link.active');
      btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 0);
  }

  get tripId() { return this.id; }

  editTrip(trip: Trip) {
    this.dialog.open(TripFormDialogComponent, {
      data: { trip }, width: '560px', maxWidth: '96vw', maxHeight: '92vh', panelClass: 'trip-dialog',
    });
  }

  deleteTrip(trip: Trip) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Trip', message: `Delete "${trip.name}"? This cannot be undone.` },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.tripService.deleteTrip(trip.id!)).subscribe({
          next: () => {
            this.snackBar.open('Trip deleted', undefined, { duration: 2500 });
            this.router.navigate(['/trips']);
          },
          error: () => this.snackBar.open('Could not delete the trip. Please try again.', undefined, { duration: 3500 }),
        });
      }
    });
  }

  back() {
    this.router.navigate(['/trips']);
  }

  readonly shareBusy = signal(false);

  shareUrl(trip: Trip): string {
    return trip.shareToken ? `${location.origin}/s/${trip.shareToken}` : '';
  }

  togglePublicShare(trip: Trip, enabled: boolean) {
    this.shareBusy.set(true);
    const action = enabled
      ? this.tripService.enablePublicShare(trip.id!, trip.shareToken)
      : this.tripService.disablePublicShare(trip.id!);
    from(action).subscribe({
      next: () => {
        this.shareBusy.set(false);
        this.snackBar.open(enabled ? 'Public link enabled' : 'Public link disabled', undefined, { duration: 2500 });
      },
      error: () => {
        this.shareBusy.set(false);
        this.snackBar.open('Could not update sharing', undefined, { duration: 3000 });
      },
    });
  }

  copyShareLink(trip: Trip) {
    const url = this.shareUrl(trip);
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => this.snackBar.open('Link copied', undefined, { duration: 2000 }),
      () => this.snackBar.open('Could not copy link', undefined, { duration: 2500 }),
    );
  }

  /** Rotate the share token — the previous link stops working immediately. */
  regenerateShareLink(trip: Trip) {
    this.shareBusy.set(true);
    from(this.tripService.regeneratePublicShareToken(trip.id!)).subscribe({
      next: () => {
        this.shareBusy.set(false);
        this.snackBar.open('New link generated — the old one no longer works', undefined, { duration: 3500 });
      },
      error: () => {
        this.shareBusy.set(false);
        this.snackBar.open('Could not regenerate link', undefined, { duration: 3000 });
      },
    });
  }

  /** Calendar-day "trip is happening right now" check (same math as trip cards). */
  private isOngoing(trip: Trip): boolean {
    const today = localDayNum(new Date());
    return today >= utcDayNum(trip.startDate.toDate())
        && today <= utcDayNum(trip.endDate.toDate());
  }

  tripDuration(trip: Trip): number {
    const ms = trip.endDate.toDate().getTime() - trip.startDate.toDate().getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1;
  }
}
