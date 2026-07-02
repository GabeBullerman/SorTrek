import { Component, Input, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { TitleCasePipe, DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { catchError, map } from 'rxjs/operators';
import { combineLatest, from, of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { ItineraryService } from '../../../core/services/itinerary.service';
import { ItineraryItem } from '../../../core/models/itinerary-item.model';
import { BookingService } from '../../../core/services/booking.service';
import { Booking } from '../../../core/models/booking.model';
import { TransportService, LocalOption, NearbyStop } from '../../../core/services/transport.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { Trip } from '../../../core/models/trip.model';
import { ItineraryItemDialogComponent } from './itinerary-item-dialog/itinerary-item-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TimezoneService } from '../../../core/services/timezone.service';
import { AuthService } from '../../../core/services/auth.service';
import { UserPreferencesService } from '../../../core/services/user-preferences.service';
import { ParticipantService } from '../../../core/services/participant.service';
import { TripParticipant } from '../../../core/models/trip-participant.model';
import { calendarDate, toCalendarTimestamp, localDayKey, utcDayKey, localDayNum } from '../../../core/util/trip-date.util';

interface DayGroup {
  date: Date;
  label: string;
  shortLabel: string;
  dayNumber: number;
  items: ItineraryItem[];
  /** Read-only entries derived from bookings that fall on this day. */
  bookingEntries: ScheduleBookingEntry[];
}

/** A booking surfaced in the schedule timeline (not editable here). */
export interface ScheduleBookingEntry {
  booking: Booking;
  icon: string;
  title: string;
  subtitle?: string;
  timeLabel?: string;
  /** Airport zone label (e.g. "MST") to annotate the time — only set for
   *  flight depart/arrive entries when the flight crosses time zones. */
  zoneLabel?: string;
  sortMinutes: number;   // minutes-of-day used to order entries within a day
  kindOrder: number;     // tiebreak when two entries share the same time
}

export interface PlanSuggestion {
  title: string;
  category: string;
  time?: string | null;
  description: string;
  location?: string | null;
  estimatedCost?: string | null;
  sourceUrl?: string | null;
  selected: boolean;
  adding?: boolean;
}

interface TransportGapOption {
  icon: string;
  title: string;
  description: string;
  bookingType: 'car-rental' | 'other';
  localOptionKey?: string;
  saved: boolean;
}

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    TitleCasePipe, DecimalPipe, MatButtonModule, MatIconModule,
    MatChipsModule, MatMenuModule, MatTooltipModule, MatProgressSpinnerModule,
  ],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss',
})
export class ScheduleComponent implements OnInit {
  @Input() tripId!: string;
  @Input() trip!: Trip;

  private itineraryService = inject(ItineraryService);
  private bookingService   = inject(BookingService);
  private transportService = inject(TransportService);
  private mapsLoader       = inject(GoogleMapsLoaderService);
  private dialog           = inject(MatDialog);
  private snackBar         = inject(MatSnackBar);
  private http             = inject(HttpClient);
  private destroyRef       = inject(DestroyRef);
  private tz               = inject(TimezoneService);
  readonly prefs           = inject(UserPreferencesService);
  private auth             = inject(AuthService);
  private participantService = inject(ParticipantService);

  /** Map of uid → display name for resolving proposer attribution. */
  private participantsByUid = signal<Record<string, string>>({});

  allDays          = signal<DayGroup[]>([]);
  selectedDayIndex = signal(0);
  findingPlans     = signal(false);
  showPlanPanel    = signal(false);
  planSuggestions  = signal<PlanSuggestion[]>([]);

  // ── Transport gap state ───────────────────────────────────
  bookings            = signal<Booking[]>([]);
  showTransportGap    = signal(false);
  loadingGapOptions   = signal(false);
  gapOptions          = signal<TransportGapOption[]>([]);
  gapDismissed        = signal<Set<number>>(new Set());

  readonly selectedDay = computed(() => this.allDays()[this.selectedDayIndex()] ?? null);

  /** One-shot: jump to today's tab the first time days load for an ongoing trip. */
  private focusedToday = false;

  ngOnInit() {
    combineLatest([
      this.itineraryService.getItems(this.tripId).pipe(catchError(() => of([] as ItineraryItem[]))),
      this.bookingService.getBookings(this.tripId).pipe(catchError(() => of([] as Booking[]))),
    ]).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([items, bookings]) => {
        this.bookings.set(bookings);
        this.allDays.set(this.groupByDay(items, bookings));
        this.focusToday();
      });

    // Resolve proposer names for the "Proposed by …" chip.
    this.participantService.getParticipants(this.tripId)
      .pipe(catchError(() => of([] as TripParticipant[])), takeUntilDestroyed(this.destroyRef))
      .subscribe((participants) => {
        const map: Record<string, string> = {};
        for (const p of participants) {
          if (p.userId) map[p.userId] = p.name;
        }
        this.participantsByUid.set(map);
      });
  }

  /** Whether the current user may edit the schedule directly (vs. propose). */
  canEditSchedule(): boolean {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.trip) return false;
    return this.trip.userId === uid
      || (this.trip.ownerIds ?? []).includes(uid)
      || (this.trip.scheduleEditorIds ?? []).includes(uid);
  }

  /** True if the proposed item was proposed by the current user. */
  isMyProposal(item: ItineraryItem): boolean {
    return !!item.proposed && item.proposedBy === this.auth.currentUser?.uid;
  }

  /** Resolve a label for a proposed item's proposer; falls back to "Proposed". */
  proposerLabel(item: ItineraryItem): string {
    const name = item.proposedBy ? this.participantsByUid()[item.proposedBy] : undefined;
    return name ? `Proposed by ${name}` : 'Proposed';
  }

  /**
   * When the trip is in progress, land on today's tab (once, on first load)
   * so mid-trip the schedule opens where the family actually is.
   */
  private focusToday() {
    if (this.focusedToday) return;
    const days = this.allDays();
    if (!days.length) return;
    this.focusedToday = true;
    const today = localDayNum(new Date());
    const idx = days.findIndex(d => localDayNum(d.date) === today);
    if (idx > 0) this.selectDay(idx);
  }

  /** True while this day is the real-world today (drives the "today" marker). */
  isToday(day: DayGroup): boolean {
    return localDayNum(day.date) === localDayNum(new Date());
  }

  /**
   * Highlight the activity happening right now on today's timeline — or, if
   * nothing is in progress, the next one coming up.
   */
  isCurrentItem(day: DayGroup, item: ItineraryItem): boolean {
    if (!this.isToday(day) || item.proposed) return false;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (t?: string) => {
      if (!t) return null;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const timed = day.items.filter(i => !i.proposed && toMin(i.startTime) !== null);
    // In progress?
    const current = timed.find(i => {
      const s = toMin(i.startTime)!;
      const e = toMin(i.endTime) ?? s + 60;
      return nowMin >= s && nowMin < e;
    });
    if (current) return current.id === item.id;
    // Otherwise the next upcoming timed item.
    const next = timed.filter(i => toMin(i.startTime)! >= nowMin)
      .sort((a, b) => toMin(a.startTime)! - toMin(b.startTime)!)[0];
    return next?.id === item.id;
  }

  /** Links saved without a protocol would resolve relative to the app — force https. */
  safeUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  // ── Voting on proposals ───────────────────────────────────

  myVote(item: ItineraryItem): 'up' | 'down' | null {
    const uid = this.auth.currentUser?.uid;
    return (uid && item.votes?.[uid]) || null;
  }

  voteCount(item: ItineraryItem, dir: 'up' | 'down'): number {
    return Object.values(item.votes ?? {}).filter(v => v === dir).length;
  }

  /** Toggle the caller's vote: tapping the same direction again retracts it. */
  vote(item: ItineraryItem, dir: 'up' | 'down') {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !item.id) return;
    const next = this.myVote(item) === dir ? null : dir;
    from(this.itineraryService.setVote(item.id, uid, next)).subscribe({
      error: () => this.snackBar.open('Could not save your vote. Please try again.', undefined, { duration: 3000 }),
    });
  }

  /** Approve a proposed item (editors only) — clears the proposed flag. */
  approveItem(item: ItineraryItem) {
    from(this.itineraryService.approveItem(item.id!)).subscribe({
      next: () => this.snackBar.open(`"${item.title}" approved`, undefined, { duration: 2000 }),
      error: () => this.snackBar.open('Could not approve. Please try again.', undefined, { duration: 3000 }),
    });
  }

  /** Reject a proposed item (editors only) — deletes it after confirmation. */
  rejectItem(item: ItineraryItem) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Reject Proposal', message: `Reject and remove "${item.title}"?` },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.itineraryService.deleteItem(item.id!)).subscribe({
          next: () => this.snackBar.open('Proposal rejected', undefined, { duration: 2000 }),
          error: () => this.snackBar.open('Could not reject. Please try again.', undefined, { duration: 3000 }),
        });
      }
    });
  }

  hasTransport(day: DayGroup): boolean {
    // A transport activity, a flight/car-rental booking on this day, OR a
    // multi-day car rental whose period covers this day, all count.
    return day.items.some(i => i.category === 'transport' || i.category === 'drive')
      || day.bookingEntries.some(e => e.booking.type === 'flight' || e.booking.type === 'car-rental')
      || this.bookings().some(b => b.type === 'car-rental' && b.status !== 'cancelled'
            && this.dayWithinBooking(day.date, b));
  }

  /** True if the day falls within a booking's check-in → check-out span (inclusive). */
  private dayWithinBooking(day: Date, b: Booking): boolean {
    if (!b.checkIn) return false;
    // Compare calendar days: `day` is a grid local-midnight date; booking times
    // are real instants placed on their local calendar day.
    const d = localDayNum(day);
    const start = localDayNum(b.checkIn.toDate());
    const end = b.checkOut ? localDayNum(b.checkOut.toDate()) : start;
    return d >= start && d <= end;
  }

  isFirstDay(day: DayGroup): boolean {
    return day.dayNumber === 1;
  }

  isLastDay(day: DayGroup): boolean {
    return day.dayNumber === this.allDays().length;
  }

  categoryIcon(cat: string): string {
    const icons: Record<string, string> = {
      transport: 'directions_car', drive: 'route', accommodation: 'hotel',
      activity: 'local_activity', food: 'restaurant', other: 'more_horiz',
    };
    return icons[cat] ?? 'circle';
  }

  stopIcon(kind: string): string {
    const icons: Record<string, string> = {
      gas: 'local_gas_station', food: 'restaurant', sights: 'photo_camera',
      rest: 'airline_seat_recline_normal', other: 'pin_drop',
    };
    return icons[kind] ?? 'pin_drop';
  }

  private groupByDay(items: ItineraryItem[], bookings: Booking[]): DayGroup[] {
    // Trip bounds are calendar days (stored at UTC midnight). Turn them into
    // local-midnight Dates of the same calendar day so the grid iterates and
    // compares in a single, timezone-stable calendar space — no day shifting,
    // and the last day is always included.
    const start = calendarDate(this.trip.startDate);
    const end   = calendarDate(this.trip.endDate);
    const bookingEntries = this.buildBookingEntries(bookings);
    const days: DayGroup[] = [];
    const cur = new Date(start);
    let dayNum = 1;

    while (cur <= end) {
      const key = localDayKey(cur);
      days.push({
        date: new Date(cur),
        label:      cur.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
        shortLabel: cur.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        dayNumber: dayNum,
        items: items
          // Activity dates are calendar days (UTC midnight) → compare via UTC key.
          .filter(i => utcDayKey(i.date.toDate()) === key)
          .sort((a, b) => {
            if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
            return a.order - b.order;
          }),
        bookingEntries: bookingEntries
          .filter(e => e.day === key)
          .sort((a, b) => a.entry.sortMinutes - b.entry.sortMinutes || a.entry.kindOrder - b.entry.kindOrder)
          .map(e => e.entry),
      });
      cur.setDate(cur.getDate() + 1);
      dayNum++;
    }
    return days;
  }

  /** Turn each booking into one or two dated schedule entries (e.g. flight
   *  departure + arrival; hotel check-in + check-out). */
  private buildBookingEntries(bookings: Booking[]): { day: string; entry: ScheduleBookingEntry }[] {
    const out: { day: string; entry: ScheduleBookingEntry }[] = [];

    // When no explicit time is set, fall back to a sensible default time-of-day
    // per kind so a typical day flows: land → rent car → check in … then
    // check out → drop car → fly out. Each kind also has a tiebreak order.
    const KIND: Record<string, { default: number; order: number }> = {
      'flight-arrive': { default: 9 * 60,  order: 0 },
      'car-pickup':    { default: 10 * 60, order: 1 },
      'checkin':       { default: 15 * 60, order: 2 },
      'other':         { default: 12 * 60, order: 3 },
      'checkout':      { default: 11 * 60, order: 4 },
      'car-dropoff':   { default: 17 * 60, order: 5 },
      'flight-depart': { default: 18 * 60, order: 6 },
    };

    const push = (
      ts: Timestamp | undefined,
      kind: keyof typeof KIND,
      entry: Pick<ScheduleBookingEntry, 'booking' | 'icon' | 'title' | 'subtitle'>,
      airport?: string | null,
    ) => {
      if (!ts) return;
      const instant = ts.toDate();
      // Read the time in the AIRPORT's zone for flights (airport set); otherwise
      // (hotels/cars, no airport) fall back to the device-local wall time.
      const wall = this.tz.zoneWallParts(instant, airport);
      const [hh, mm] = wall.time.split(':').map(Number);
      const hasTime = !(hh === 0 && mm === 0);
      const k = KIND[kind];
      out.push({
        // Placed on the airport-local (or device-local) calendar day.
        day: localDayKey(wall.date),
        entry: {
          ...entry,
          timeLabel: hasTime ? (this.tz.formatTime(instant, airport) ?? undefined) : undefined,
          zoneLabel: hasTime ? (this.tz.zoneLabel(airport, instant) ?? undefined) : undefined,
          sortMinutes: hasTime ? hh * 60 + mm : k.default,
          kindOrder: k.order,
        },
      });
    };

    for (const b of bookings) {
      if (b.status === 'cancelled') continue;
      if (b.type === 'flight') {
        const route = [b.departureAirport, ...(b.layovers ?? []), b.arrivalAirport].filter(Boolean).join(' → ');
        // Departure time/day in the departure airport's zone; arrival in the
        // arrival airport's zone.
        push(b.checkIn,  'flight-depart', { booking: b, icon: 'flight_takeoff', title: `Depart — ${b.title}`, subtitle: route || undefined }, b.departureAirport);
        push(b.checkOut, 'flight-arrive', { booking: b, icon: 'flight_land',    title: `Arrive — ${b.title}`, subtitle: route || undefined }, b.arrivalAirport);
      } else if (b.type === 'hotel' || b.type === 'airbnb') {
        push(b.checkIn,  'checkin',  { booking: b, icon: 'login',  title: `Check-in — ${b.title}`,  subtitle: b.provider });
        push(b.checkOut, 'checkout', { booking: b, icon: 'logout', title: `Check-out — ${b.title}`, subtitle: b.provider });
      } else if (b.type === 'car-rental') {
        push(b.checkIn,  'car-pickup',  { booking: b, icon: 'directions_car', title: `Pick-up — ${b.title}`,  subtitle: b.provider });
        push(b.checkOut, 'car-dropoff', { booking: b, icon: 'directions_car', title: `Drop-off — ${b.title}`, subtitle: b.provider });
      } else {
        push(b.checkIn,  'other', { booking: b, icon: 'bookmark', title: b.title, subtitle: b.provider });
      }
    }
    return out;
  }

  selectDay(index: number) {
    this.selectedDayIndex.set(index);
    this.showPlanPanel.set(false);
    this.planSuggestions.set([]);
    this.gapOptions.set([]);

    const day = this.allDays()[index];
    if (day) this.checkTransportGap(day);
  }

  // ── Transport gap detection ───────────────────────────────

  private checkTransportGap(day: DayGroup) {
    if (this.hasTransport(day)) { this.showTransportGap.set(false); return; }
    if (this.gapDismissed().has(day.dayNumber)) { this.showTransportGap.set(false); return; }

    const isEdgeDay = this.isFirstDay(day) || this.isLastDay(day);
    const hasFlightOrHotel = this.bookings().some(
      b => (b.type === 'flight' || b.type === 'hotel' || b.type === 'airbnb') && b.status !== 'cancelled'
    );

    if (isEdgeDay || hasFlightOrHotel) {
      this.showTransportGap.set(true);
    } else {
      this.showTransportGap.set(false);
    }
  }

  dismissGap() {
    const day = this.selectedDay();
    if (!day) return;
    this.gapDismissed.update(s => new Set([...s, day.dayNumber]));
    this.showTransportGap.set(false);
    this.gapOptions.set([]);
  }

  findTransportOptions() {
    this.loadingGapOptions.set(true);
    this.gapOptions.set([]);

    this.mapsLoader.load().subscribe(loaded => {
      if (!loaded) {
        this.loadingGapOptions.set(false);
        return;
      }
      const geocoder = new (window as any).google.maps.Geocoder();
      geocoder.geocode({ address: this.trip.destination }, (results: any[], status: string) => {
        if (status !== 'OK' || !results?.[0]) {
          this.loadingGapOptions.set(false);
          return;
        }
        const loc = results[0].geometry.location;
        this.transportService.getLocalOptions(loc.lat(), loc.lng()).subscribe(data => {
          const options = this.buildGapOptions(data.localSummary ?? [], data.nearbyStops ?? []);
          this.gapOptions.set(options);
          this.loadingGapOptions.set(false);
        });
      });
    });
  }

  private buildGapOptions(summary: LocalOption[], stops: NearbyStop[]): TransportGapOption[] {
    const iconMap: Record<string, string> = {
      'Bike Share':             'pedal_bike',
      'Bus':                    'directions_bus',
      'Tram':                   'tram',
      'Subway / Metro':         'subway',
      'Taxi Stand':             'local_taxi',
      'Car Rental':             'directions_car',
      'Car Sharing':            'car_rental',
      'Scooter / Moto Rental':  'two_wheeler',
      'Ferry':                  'directions_boat',
    };
    const isRental = (t: string) => t === 'Car Rental' || t === 'Car Sharing' || t === 'Scooter / Moto Rental';

    const fromSummary: TransportGapOption[] = summary.map(opt => ({
      icon: iconMap[opt.type] ?? 'directions_transit',
      title: `${opt.type} — ${opt.count} location${opt.count !== 1 ? 's' : ''} nearby`,
      description: `${opt.count} ${opt.type} location${opt.count !== 1 ? 's' : ''} found within 1.5–2 km of ${this.trip.destination}.`,
      bookingType: isRental(opt.type) ? 'car-rental' : 'other',
      localOptionKey: opt.type,
      saved: false,
    }));

    const topStops: TransportGapOption[] = stops.slice(0, 3).map(stop => ({
      icon: 'directions_transit',
      title: `${stop.name}`,
      description: `Transit stop ${stop.distance}m from city centre.`,
      bookingType: 'other',
      saved: false,
    }));

    return [...fromSummary, ...topStops];
  }

  saveGapOptionAsBooking(index: number) {
    const opt = this.gapOptions()[index];
    if (!opt || opt.saved) return;

    from(this.bookingService.createBooking({
      tripId: this.tripId,
      type: opt.bookingType,
      title: opt.title,
      status: 'suggested',
      notes: `SUGGESTION — not yet booked. ${opt.description} Confirm and update status once you have arranged transport.`,
    })).subscribe(() => {
      this.gapOptions.update(list =>
        list.map((o, i) => i === index ? { ...o, saved: true } : o)
      );
      this.snackBar.open('Saved as suggestion in Bookings tab', undefined, { duration: 2500 });
    });
  }

  // ── Find Plans (existing) ─────────────────────────────────

  findPlans() {
    const day = this.selectedDay();
    if (!day || this.findingPlans()) return;
    this.findingPlans.set(true);
    this.showPlanPanel.set(true);
    this.planSuggestions.set([]);

    this.http.post<{ suggestions: PlanSuggestion[] }>('/api/find-plans', {
      destination: this.trip.destination,
      // Send the calendar day as UTC-midnight ISO so the server reads the same
      // day regardless of anyone's timezone.
      date: toCalendarTimestamp(day.date).toDate().toISOString(),
      dayNumber: day.dayNumber,
      totalDays: this.allDays().length,
    }).pipe(catchError(() => of({ suggestions: [] })))
      .subscribe(res => {
        this.planSuggestions.set((res.suggestions ?? []).map(s => ({ ...s, selected: false })));
        this.findingPlans.set(false);
      });
  }

  closePlanPanel() {
    this.showPlanPanel.set(false);
    this.planSuggestions.set([]);
  }

  addSuggestion(index: number) {
    const day = this.selectedDay();
    if (!day) return;
    const s = this.planSuggestions()[index];

    this.planSuggestions.update(list =>
      list.map((item, i) => i === index ? { ...item, adding: true } : item)
    );

    const newItem: Omit<ItineraryItem, 'id'> = {
      tripId: this.tripId,
      title: s.title,
      category: (['transport','accommodation','activity','food','other'].includes(s.category)
        ? s.category : 'activity') as ItineraryItem['category'],
      date: toCalendarTimestamp(day.date),
      order: day.items.length,
      ...(s.time       ? { startTime: s.time }         : {}),
      ...(s.location   ? { location: s.location }       : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(s.sourceUrl  ? { link: s.sourceUrl }          : {}),
      // Non-editors can only create proposed items (Firestore rules enforce this).
      ...(this.canEditSchedule()
        ? {}
        : { proposed: true, proposedBy: this.auth.currentUser?.uid }),
    };

    from(this.itineraryService.createItem(newItem)).subscribe({
      next: () => {
        this.planSuggestions.update(list =>
          list.map((item, i) => i === index ? { ...item, adding: false, selected: true } : item)
        );
        this.snackBar.open(`"${s.title}" added to Day ${day.dayNumber}`, undefined, { duration: 2000 });
      },
      error: () => {
        this.planSuggestions.update(list => list.map((item, i) => i === index ? { ...item, adding: false } : item));
        this.snackBar.open('Could not add that plan. Please try again.', undefined, { duration: 3000 });
      },
    });
  }

  openAddItem(date: Date, existingCount: number) {
    this.dialog.open(ItineraryItemDialogComponent, {
      data: { tripId: this.tripId, defaultDate: date, existingCount, propose: !this.canEditSchedule() },
      width: '600px', maxHeight: '90vh',
    });
  }

  openEditItem(item: ItineraryItem, allItems: ItineraryItem[]) {
    this.dialog.open(ItineraryItemDialogComponent, {
      data: { tripId: this.tripId, item, existingCount: allItems.length },
      width: '600px', maxHeight: '90vh',
    });
  }

  deleteItem(item: ItineraryItem) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Remove Activity', message: `Remove "${item.title}"?` },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.itineraryService.deleteItem(item.id!)).subscribe({
          next: () => this.snackBar.open('Activity removed', undefined, { duration: 2000 }),
          error: () => this.snackBar.open('Could not remove the activity. Please try again.', undefined, { duration: 3000 }),
        });
      }
    });
  }
}

/** Local-midnight timestamp for a date, for day-range comparisons. */
