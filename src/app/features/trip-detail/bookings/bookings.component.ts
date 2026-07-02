import { Component, Input, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AsyncPipe, DatePipe, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { BookingService } from '../../../core/services/booking.service';
import { FlightService } from '../../../core/services/flight.service';
import { ParticipantService } from '../../../core/services/participant.service';
import { TimezoneService } from '../../../core/services/timezone.service';
import { Booking, BookingType, FlightStatus } from '../../../core/models/booking.model';
import { Timestamp } from '@angular/fire/firestore';
import { TripParticipant } from '../../../core/models/trip-participant.model';
import { BookingDialogComponent } from './booking-dialog/booking-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmailScanDialogComponent } from './email-scan-dialog/email-scan-dialog.component';
import { map, catchError } from 'rxjs/operators';
import { Observable, of, from, combineLatest, timer } from 'rxjs';
import { Trip } from '../../../core/models/trip.model';

interface BookingGroup {
  type: BookingType;
  label: string;
  icon: string;
  bookings: Booking[];
}

interface TravelHint {
  icon: string;
  text: string;
}

interface BookingsData {
  groups: BookingGroup[];
  participants: TripParticipant[];
}

@Component({
  selector: 'app-bookings',
  standalone: true,
  imports: [
    AsyncPipe, DatePipe, CurrencyPipe, TitleCasePipe,
    MatButtonModule, MatIconModule, MatMenuModule,
    MatTooltipModule, MatProgressSpinnerModule, MatExpansionModule, MatChipsModule,
    MatFormFieldModule, MatInputModule,
  ],
  templateUrl: './bookings.component.html',
  styleUrl: './bookings.component.scss',
})
export class BookingsComponent implements OnInit {
  @Input() tripId!: string;
  @Input() trip!: Trip;

  private bookingService = inject(BookingService);
  private flightService = inject(FlightService);
  private participantService = inject(ParticipantService);
  private tz = inject(TimezoneService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  data$!: Observable<BookingsData>;

  /** Booking ids currently being refreshed, so we can show a spinner per card. */
  refreshing = new Set<string>();

  /** Client-side search term for filtering the booking list. */
  searchTerm = signal('');

  /** Total bookings across all groups (used to decide whether to show search). */
  totalBookings(groups: BookingGroup[]): number {
    return groups.reduce((n, g) => n + g.bookings.length, 0);
  }

  /** Filter groups by the current search term, matching booking text fields.
   *  Empty term returns all groups; groups with no matches are dropped. */
  filterGroups(groups: BookingGroup[]): BookingGroup[] {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map(g => ({ ...g, bookings: g.bookings.filter(b => this.bookingMatches(b, term)) }))
      .filter(g => g.bookings.length > 0);
  }

  private bookingMatches(b: Booking, term: string): boolean {
    const fields = [
      b.title,
      b.provider,
      b.confirmationNumber,
      b.type,
      b.flightNumber,
      b.departureAirport,
      b.arrivalAirport,
      ...(b.layovers ?? []),
    ];
    return fields.some(f => f?.toLowerCase().includes(term));
  }

  /** Latest booking list, kept for the background flight-status poller. */
  private latestBookings: Booking[] = [];

  ngOnInit() {
    this.data$ = combineLatest([
      this.bookingService.getBookings(this.tripId),
      this.participantService.getParticipants(this.tripId),
    ]).pipe(
      map(([bookings, participants]) => {
        this.latestBookings = bookings;
        return {
          groups: this.groupBookings(bookings),
          participants,
        };
      }),
      catchError(() => of({ groups: [], participants: [] }))
    );

    // Live flight tracking: check every 60s, but only actually hit the API for
    // flights inside their "interesting" window (48h before departure until
    // shortly after arrival) that haven't landed. Far-future flights cost
    // nothing, and nothing runs while the tab is hidden.
    timer(5_000, 60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.autoPollFlights());
  }

  private autoPollFlights() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = Date.now();
    const H = 3_600_000;

    for (const b of this.latestBookings) {
      if (b.type !== 'flight' || !b.flightNumber || !b.id || b.status === 'cancelled') continue;
      if (this.refreshing.has(b.id)) continue;

      const dep = b.checkIn?.toDate().getTime();
      if (!dep) continue;
      const arr = b.checkOut?.toDate().getTime() ?? dep + 6 * H;
      if (now < dep - 48 * H || now > arr + 2 * H) continue;               // outside window
      if ((b.flightStatus?.flightStatus ?? '').toLowerCase() === 'landed') continue; // done
      const lastUpdate = b.flightStatus?.updatedAt?.toDate().getTime() ?? 0;
      if (now - lastUpdate < 55_000) continue;                              // recently refreshed

      this.silentRefreshFlight(b);
    }
  }

  /** Background variant of refreshFlightStatus: writes updates, never toasts. */
  private silentRefreshFlight(booking: Booking) {
    const date = booking.checkIn ? this.toDateStr(booking.checkIn.toDate()) : undefined;
    this.flightService.getStatus(booking.flightNumber!, date).subscribe(res => {
      if (res.error || res.configured === false || !res.found || !res.status) return;
      const s = res.status;
      const changes: Partial<Booking> = { flightStatus: { ...s, updatedAt: Timestamp.now() } };
      const bestDep = s.actualDeparture ?? s.estimatedDeparture ?? s.scheduledDeparture;
      const bestArr = s.actualArrival ?? s.estimatedArrival ?? s.scheduledArrival;
      if (bestDep) changes.checkIn = Timestamp.fromDate(new Date(bestDep));
      if (bestArr) changes.checkOut = Timestamp.fromDate(new Date(bestArr));
      from(this.bookingService.updateBooking(booking.id!, changes))
        .subscribe({ error: () => { /* silent — next tick retries */ } });
    });
  }

  typeConfig: Record<BookingType, { label: string; icon: string }> = {
    flight: { label: 'Flights', icon: 'flight' },
    hotel: { label: 'Hotels', icon: 'hotel' },
    airbnb: { label: 'Airbnb / Vacation Rentals', icon: 'home' },
    'car-rental': { label: 'Car Rentals', icon: 'directions_car' },
    other: { label: 'Other Bookings', icon: 'bookmark' },
  };

  /** Home airport = where the trip starts: the departure airport of the
   *  earliest flight. Used to label outbound (arrival) vs return (departure). */
  private homeAirport: string | null = null;

  private groupBookings(bookings: Booking[]): BookingGroup[] {
    const flights = bookings.filter(b => b.type === 'flight' && b.departureAirport);
    this.homeAirport = [...flights].sort(byDate)[0]?.departureAirport ?? null;

    const types: BookingType[] = ['flight', 'hotel', 'airbnb', 'car-rental', 'other'];
    return types
      .map(type => ({
        type,
        label: this.typeConfig[type].label,
        icon: this.typeConfig[type].icon,
        bookings: bookings
          .filter(b => b.type === type)
          .sort(type === 'flight' ? (a, b) => this.compareFlights(a, b) : byDate),
      }))
      .filter(g => g.bookings.length > 0);
  }

  /** 'arrival' = heading to the destination (departs home); 'departure' =
   *  heading home (arrives home). Null when it can't be determined. */
  flightDirection(b: Booking): 'arrival' | 'departure' | null {
    if (b.type !== 'flight' || !this.homeAirport) return null;
    if (b.departureAirport === this.homeAirport) return 'arrival';
    if (b.arrivalAirport === this.homeAirport) return 'departure';
    return null;
  }

  /** Order flights arrival-first, then departure, then undetermined; by date within. */
  private compareFlights(a: Booking, b: Booking): number {
    const rank = (x: Booking) => {
      const d = this.flightDirection(x);
      return d === 'arrival' ? 0 : d === 'departure' ? 1 : 2;
    };
    return rank(a) - rank(b) || byDate(a, b);
  }

  getTravelHints(groups: BookingGroup[]): TravelHint[] {
    const hints: TravelHint[] = [];
    const bookings = groups.flatMap(g => g.bookings);
    const flights = bookings.filter(b => b.type === 'flight');
    const accommodation = bookings.filter(b => b.type === 'hotel' || b.type === 'airbnb');
    const nights = Math.round(
      (this.trip.endDate.toDate().getTime() - this.trip.startDate.toDate().getTime())
      / (1000 * 60 * 60 * 24)
    );

    if (flights.length === 0) {
      hints.push({ icon: 'flight_takeoff', text: 'No outbound flight booked yet.' });
      if (nights >= 1) {
        hints.push({ icon: 'flight_land', text: 'No return flight booked yet.' });
      }
    } else if (flights.length === 1 && nights >= 1) {
      hints.push({ icon: 'flight_land', text: 'You have 1 flight booked — don\'t forget your return flight.' });
    }

    if (accommodation.length === 0 && nights >= 1) {
      hints.push({ icon: 'hotel', text: `No accommodation booked for ${nights} night${nights !== 1 ? 's' : ''}.` });
    }

    return hints;
  }

  getPassengerNames(booking: Booking, participants: TripParticipant[]): string[] {
    if (!booking.passengerIds?.length) return [];
    return booking.passengerIds
      .map(id => participants.find(p => p.id === id)?.name ?? '?')
      .filter(Boolean);
  }

  getPayerName(booking: Booking, participants: TripParticipant[]): string | null {
    if (booking.paidById == null) return null;
    return participants.find(p => p.id === booking.paidById)?.name ?? null;
  }

  /** Full route string including any layovers, e.g. "MAD → LIS → JFK". */
  routeWithLayovers(booking: Booking): string {
    const stops = [
      booking.departureAirport ?? '?',
      ...(booking.layovers ?? []),
      booking.arrivalAirport ?? '?',
    ];
    return stops.join(' → ');
  }

  /** Resolve per-passenger ticket numbers to [name, ticket] pairs for display.
   *  Prefers the free-form passengerTickets; falls back to legacy ticketNumbers. */
  getTicketEntries(booking: Booking, participants: TripParticipant[]): { name: string; ticket: string }[] {
    if (booking.passengerTickets?.length) {
      return booking.passengerTickets.map(pt => ({ name: pt.name || 'Passenger', ticket: pt.ticket }));
    }
    if (booking.ticketNumbers) {
      return Object.entries(booking.ticketNumbers).map(([id, ticket]) => ({
        name: participants.find(p => p.id === id)?.name ?? 'Passenger',
        ticket,
      }));
    }
    return [];
  }

  /** Departure date+time shown in the DEPARTURE airport's local zone (flights);
   *  viewer-local for non-flights / unknown airports. */
  depDateTime(b: Booking): string | null {
    if (!b.checkIn) return null;
    return this.formatZoned(b.checkIn.toDate(), b.type === 'flight' ? b.departureAirport : null, this.hasTime(b.checkIn));
  }

  /** Arrival date+time shown in the ARRIVAL airport's local zone. */
  arrDateTime(b: Booking): string | null {
    if (!b.checkOut) return null;
    return this.formatZoned(b.checkOut.toDate(), b.type === 'flight' ? b.arrivalAirport : null, this.hasTime(b.checkOut));
  }

  private formatZoned(instant: Date, airport: string | null | undefined, withTime: boolean): string {
    const timeZone = this.tz.ianaFor(airport) ?? undefined;
    const opts: Intl.DateTimeFormatOptions = withTime
      ? { timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { timeZone, month: 'short', day: 'numeric', year: 'numeric' };
    try { return new Intl.DateTimeFormat('en-US', opts).format(instant); }
    catch { return instant.toLocaleString('en-US', { ...opts, timeZone: undefined }); }
  }

  /** Short zone label (e.g. "MDT") for the departure airport of a flight. */
  depZoneLabel(b: Booking): string | null {
    return b.type === 'flight' && this.hasTime(b.checkIn)
      ? this.tz.zoneLabel(b.departureAirport, b.checkIn?.toDate()) : null;
  }

  /** Short zone label (e.g. "CEST") for the arrival airport of a flight. */
  arrZoneLabel(b: Booking): string | null {
    return b.type === 'flight' && this.hasTime(b.checkOut)
      ? this.tz.zoneLabel(b.arrivalAirport, b.checkOut?.toDate()) : null;
  }

  /** True when a timestamp carries a meaningful time-of-day (not midnight). */
  hasTime(ts?: Timestamp | null): boolean {
    if (!ts) return false;
    const d = ts.toDate();
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  /** Pull fresh status for a flight booking and write it back to Firestore. */
  refreshFlightStatus(booking: Booking) {
    if (!booking.id || !booking.flightNumber) return;
    this.refreshing.add(booking.id);
    const date = booking.checkIn ? this.toDateStr(booking.checkIn.toDate()) : undefined;

    this.flightService.getStatus(booking.flightNumber, date).subscribe(res => {
      this.refreshing.delete(booking.id!);
      if (res.error || res.configured === false) {
        this.snackBar.open(res.message ?? res.error ?? 'Flight tracking unavailable', undefined, { duration: 3500 });
        return;
      }
      if (!res.found || !res.status) {
        const days = booking.checkIn
          ? Math.ceil((booking.checkIn.toDate().getTime() - Date.now()) / 86400000)
          : null;
        const msg = days != null && days > 3
          ? `No live status yet — departs in ${days} days. Airlines post tracking ~1–3 days out.`
          : (res.message ?? 'No live data for this flight yet');
        this.snackBar.open(msg, undefined, { duration: 4000 });
        return;
      }

      const s = res.status;
      const flightStatus: FlightStatus = { ...s, updatedAt: Timestamp.now() };
      const bestDep = s.actualDeparture ?? s.estimatedDeparture ?? s.scheduledDeparture;
      const bestArr = s.actualArrival ?? s.estimatedArrival ?? s.scheduledArrival;
      const changes: Partial<Booking> = { flightStatus };
      if (bestDep) changes.checkIn = Timestamp.fromDate(new Date(bestDep));
      if (bestArr) changes.checkOut = Timestamp.fromDate(new Date(bestArr));

      from(this.bookingService.updateBooking(booking.id!, changes)).subscribe(() =>
        this.snackBar.open(`Updated: ${s.flightStatus ?? 'status'}`, undefined, { duration: 2500 })
      );
    });
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  openAddBooking() {
    this.dialog.open(BookingDialogComponent, {
      data: { tripId: this.tripId },
      width: '640px',
      maxHeight: '90vh',
    });
  }

  openEmailScan() {
    this.dialog.open(EmailScanDialogComponent, {
      data: { trip: this.trip, tripId: this.tripId },
      width: '680px',
      maxHeight: '90vh',
    });
  }

  openEditBooking(booking: Booking) {
    this.dialog.open(BookingDialogComponent, {
      data: { tripId: this.tripId, booking },
      width: '640px',
      maxHeight: '90vh',
    });
  }

  deleteBooking(booking: Booking) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Remove Booking', message: `Remove "${booking.title}"?` },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.bookingService.deleteBooking(booking.id!)).subscribe({
          next: () => this.snackBar.open('Booking removed', undefined, { duration: 2000 }),
          error: () => this.snackBar.open('Could not remove the booking. Please try again.', undefined, { duration: 3500 }),
        });
      }
    });
  }

  openBookingUrl(url: string) {
    window.open(url, '_blank', 'noopener');
  }
}

/** Sort bookings chronologically by start date; undated ones sink to the bottom. */
function byDate(a: Booking, b: Booking): number {
  const ta = a.checkIn?.toMillis() ?? Number.POSITIVE_INFINITY;
  const tb = b.checkIn?.toMillis() ?? Number.POSITIVE_INFINITY;
  return ta - tb;
}
