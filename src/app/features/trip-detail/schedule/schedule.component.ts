import { Component, Input, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { AsyncPipe, TitleCasePipe, DecimalPipe } from '@angular/common';
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
    AsyncPipe, TitleCasePipe, DecimalPipe, MatButtonModule, MatIconModule,
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

  ngOnInit() {
    combineLatest([
      this.itineraryService.getItems(this.tripId).pipe(catchError(() => of([] as ItineraryItem[]))),
      this.bookingService.getBookings(this.tripId).pipe(catchError(() => of([] as Booking[]))),
    ]).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([items, bookings]) => {
        this.bookings.set(bookings);
        this.allDays.set(this.groupByDay(items, bookings));
      });
  }

  hasTransport(day: DayGroup): boolean {
    // A transport activity, a flight/car-rental booking on this day, OR a
    // multi-day car rental whose period covers this day, all count.
    return day.items.some(i => i.category === 'transport')
      || day.bookingEntries.some(e => e.booking.type === 'flight' || e.booking.type === 'car-rental')
      || this.bookings().some(b => b.type === 'car-rental' && b.status !== 'cancelled'
            && this.dayWithinBooking(day.date, b));
  }

  /** True if the day falls within a booking's check-in → check-out span (inclusive). */
  private dayWithinBooking(day: Date, b: Booking): boolean {
    if (!b.checkIn) return false;
    const d = day.getTime();
    const start = startOfDay(b.checkIn.toDate());
    const end = b.checkOut ? startOfDay(b.checkOut.toDate()) : start;
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
      transport: 'directions_car', accommodation: 'hotel',
      activity: 'local_activity', food: 'restaurant', other: 'more_horiz',
    };
    return icons[cat] ?? 'circle';
  }

  private groupByDay(items: ItineraryItem[], bookings: Booking[]): DayGroup[] {
    const start = this.trip.startDate.toDate();
    const end   = this.trip.endDate.toDate();
    const bookingEntries = this.buildBookingEntries(bookings);
    const days: DayGroup[] = [];
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    let dayNum = 1;

    while (cur <= end) {
      const dayStr = cur.toDateString();
      days.push({
        date: new Date(cur),
        label:      cur.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
        shortLabel: cur.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        dayNumber: dayNum,
        items: items
          .filter(i => i.date.toDate().toDateString() === dayStr)
          .sort((a, b) => {
            if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
            return a.order - b.order;
          }),
        bookingEntries: bookingEntries
          .filter(e => e.day === dayStr)
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
    const fmt = (ts: Timestamp) => ts.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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
    ) => {
      if (!ts) return;
      const d = ts.toDate();
      const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
      const k = KIND[kind];
      out.push({
        day: d.toDateString(),
        entry: {
          ...entry,
          timeLabel: hasTime ? fmt(ts) : undefined,
          sortMinutes: hasTime ? d.getHours() * 60 + d.getMinutes() : k.default,
          kindOrder: k.order,
        },
      });
    };

    for (const b of bookings) {
      if (b.status === 'cancelled') continue;
      if (b.type === 'flight') {
        const route = [b.departureAirport, ...(b.layovers ?? []), b.arrivalAirport].filter(Boolean).join(' → ');
        push(b.checkIn,  'flight-depart', { booking: b, icon: 'flight_takeoff', title: `Depart — ${b.title}`, subtitle: route || undefined });
        push(b.checkOut, 'flight-arrive', { booking: b, icon: 'flight_land',    title: `Arrive — ${b.title}`, subtitle: route || undefined });
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
      date: day.date.toISOString(),
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
      date: Timestamp.fromDate(day.date),
      order: day.items.length,
      ...(s.time       ? { startTime: s.time }         : {}),
      ...(s.location   ? { location: s.location }       : {}),
      ...(s.description ? { description: s.description } : {}),
    };

    from(this.itineraryService.createItem(newItem)).subscribe(() => {
      this.planSuggestions.update(list =>
        list.map((item, i) => i === index ? { ...item, adding: false, selected: true } : item)
      );
      this.snackBar.open(`"${s.title}" added to Day ${day.dayNumber}`, undefined, { duration: 2000 });
    });
  }

  openAddItem(date: Date, existingCount: number) {
    this.dialog.open(ItineraryItemDialogComponent, {
      data: { tripId: this.tripId, defaultDate: date, existingCount },
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
        from(this.itineraryService.deleteItem(item.id!)).subscribe(() =>
          this.snackBar.open('Activity removed', undefined, { duration: 2000 })
        );
      }
    });
  }
}

/** Local-midnight timestamp for a date, for day-range comparisons. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
