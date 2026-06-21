import { Component, Input, OnInit, inject } from '@angular/core';
import { AsyncPipe, DatePipe, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
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
import { Booking, BookingType, FlightStatus } from '../../../core/models/booking.model';
import { Timestamp } from '@angular/fire/firestore';
import { TripParticipant } from '../../../core/models/trip-participant.model';
import { BookingDialogComponent } from './booking-dialog/booking-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmailScanDialogComponent } from './email-scan-dialog/email-scan-dialog.component';
import { map, catchError } from 'rxjs/operators';
import { Observable, of, from, combineLatest } from 'rxjs';
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
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  data$!: Observable<BookingsData>;

  /** Booking ids currently being refreshed, so we can show a spinner per card. */
  refreshing = new Set<string>();

  ngOnInit() {
    this.data$ = combineLatest([
      this.bookingService.getBookings(this.tripId),
      this.participantService.getParticipants(this.tripId),
    ]).pipe(
      map(([bookings, participants]) => ({
        groups: this.groupBookings(bookings),
        participants,
      })),
      catchError(() => of({ groups: [], participants: [] }))
    );
  }

  typeConfig: Record<BookingType, { label: string; icon: string }> = {
    flight: { label: 'Flights', icon: 'flight' },
    hotel: { label: 'Hotels', icon: 'hotel' },
    airbnb: { label: 'Airbnb / Vacation Rentals', icon: 'home' },
    'car-rental': { label: 'Car Rentals', icon: 'directions_car' },
    other: { label: 'Other Bookings', icon: 'bookmark' },
  };

  private groupBookings(bookings: Booking[]): BookingGroup[] {
    const types: BookingType[] = ['flight', 'hotel', 'airbnb', 'car-rental', 'other'];
    return types
      .map(type => ({
        type,
        label: this.typeConfig[type].label,
        icon: this.typeConfig[type].icon,
        bookings: bookings.filter(b => b.type === type).sort(byDate),
      }))
      .filter(g => g.bookings.length > 0);
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
        from(this.bookingService.deleteBooking(booking.id!)).subscribe(() =>
          this.snackBar.open('Booking removed', undefined, { duration: 2000 })
        );
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
