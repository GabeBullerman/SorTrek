import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BookingService } from '../../../../core/services/booking.service';
import { FlightService, FlightStatusResult } from '../../../../core/services/flight.service';
import { Booking, BookingType, BookingStatus, FlightStatus } from '../../../../core/models/booking.model';
import { ParticipantService } from '../../../../core/services/participant.service';
import { TripParticipant } from '../../../../core/models/trip-participant.model';
import { Timestamp } from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface BookingDialogData {
  tripId: string;
  booking?: Booking;
}

/** Per-type wording so the same fields read naturally for each booking kind. */
interface TypeLabels {
  start: string;
  end: string;
  provider: string;
}

@Component({
  selector: 'app-booking-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatDatepickerModule, MatNativeDateModule,
    MatAutocompleteModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule, DatePipe, TitleCasePipe,
  ],
  templateUrl: './booking-dialog.component.html',
  styleUrl: './booking-dialog.component.scss',
})
export class BookingDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private bookingService = inject(BookingService);
  private flightService = inject(FlightService);
  private participantService = inject(ParticipantService);
  private dialogRef = inject(MatDialogRef<BookingDialogComponent>);
  private snackBar = inject(MatSnackBar);
  data = inject<BookingDialogData>(MAT_DIALOG_DATA);

  loading = signal(false);
  isEdit = !!this.data.booking;
  participants = signal<TripParticipant[]>([]);

  /** Drives the type-first flow: false until a type is chosen for a new booking. */
  typeChosen = signal(this.isEdit);
  /** Mirrors the form's `type` so the template can react (labels, flight fields). */
  selectedType = signal<BookingType>(this.data.booking?.type ?? 'flight');

  // Flight status lookup state
  statusLoading = signal(false);
  statusResult = signal<FlightStatusResult | null>(this.data.booking?.flightStatus ? toResult(this.data.booking.flightStatus) : null);
  statusMessage = signal<string | null>(null);

  bookingTypes: { value: BookingType; label: string; icon: string; hint: string }[] = [
    { value: 'flight',      label: 'Flight',                   icon: 'flight',          hint: 'Departure & arrival times, live tracking' },
    { value: 'hotel',       label: 'Hotel',                    icon: 'hotel',           hint: 'Check-in & check-out' },
    { value: 'airbnb',      label: 'Airbnb / Vacation Rental', icon: 'home',            hint: 'Check-in & check-out' },
    { value: 'car-rental',  label: 'Car Rental',               icon: 'directions_car',  hint: 'Pick-up & drop-off' },
    { value: 'other',       label: 'Other',                    icon: 'bookmark',        hint: 'Tickets, tours, anything else' },
  ];

  statuses: { value: BookingStatus; label: string }[] = [
    { value: 'confirmed',  label: 'Confirmed' },
    { value: 'pending',    label: 'Pending' },
    { value: 'cancelled',  label: 'Cancelled' },
    { value: 'suggested',  label: 'Suggestion (not yet booked)' },
  ];

  /** Wording for the date/time and provider fields, by type. */
  labels = computed<TypeLabels>(() => {
    switch (this.selectedType()) {
      case 'flight':      return { start: 'Departure',  end: 'Arrival',   provider: 'Airline' };
      case 'hotel':       return { start: 'Check-In',   end: 'Check-Out', provider: 'Hotel' };
      case 'airbnb':      return { start: 'Check-In',   end: 'Check-Out', provider: 'Host / Platform' };
      case 'car-rental':  return { start: 'Pick-Up',    end: 'Drop-Off',  provider: 'Rental Company' };
      default:            return { start: 'Start',      end: 'End',       provider: 'Provider' };
    }
  });

  isFlight = computed(() => this.selectedType() === 'flight');

  /** Names suggested in the passenger dropdown: trip members / invited people. */
  passengerOptions = computed(() =>
    [...new Set(this.participants().map(p => p.name).filter(Boolean))]
  );

  form = this.fb.group({
    type: [this.data.booking?.type ?? 'flight' as BookingType, Validators.required],
    title: [this.data.booking?.title ?? '', Validators.required],
    provider: [this.data.booking?.provider ?? ''],
    confirmationNumber: [this.data.booking?.confirmationNumber ?? ''],
    bookingUrl: [this.data.booking?.bookingUrl ?? ''],
    checkIn: [this.data.booking?.checkIn?.toDate() ?? null],
    checkInTime: [toTimeStr(this.data.booking?.checkIn?.toDate())],
    checkOut: [this.data.booking?.checkOut?.toDate() ?? null],
    checkOutTime: [toTimeStr(this.data.booking?.checkOut?.toDate())],
    flightNumber: [this.data.booking?.flightNumber ?? ''],
    departureAirport: [this.data.booking?.departureAirport ?? ''],
    arrivalAirport: [this.data.booking?.arrivalAirport ?? ''],
    connections: this.fb.array<FormGroup>([]),
    cost: [this.data.booking?.cost ?? null],
    currency: [this.data.booking?.currency ?? 'USD'],
    status: [this.data.booking?.status ?? 'confirmed' as BookingStatus, Validators.required],
    notes: [this.data.booking?.notes ?? ''],
    passengerIds: [this.data.booking?.passengerIds ?? [] as string[]],
    paidById: [this.data.booking?.paidById ?? null as string | null],
    passengerTickets: this.fb.array<FormGroup>([]),
  });

  ngOnInit() {
    // Seed the free-form passenger/ticket rows from any saved data.
    const saved = this.data.booking?.passengerTickets ?? [];
    for (const pt of saved) this.addPassengerTicket(pt.name, pt.ticket);

    // Seed connecting flights from saved data, migrating legacy plain layovers.
    const conns: { airport: string; flightNumber?: string; departTime?: string }[] =
      this.data.booking?.connections
      ?? (this.data.booking?.layovers ?? []).map(a => ({ airport: a }));
    for (const c of conns) this.addConnection(c.airport, c.flightNumber, c.departTime);

    this.participantService.getParticipants(this.data.tripId).subscribe(p => {
      this.participants.set(p);
    });
  }

  get passengerTickets(): FormArray<FormGroup> {
    return this.form.controls.passengerTickets;
  }

  /** Add an empty (or pre-filled) passenger/ticket row. */
  addPassengerTicket(name = '', ticket = '') {
    this.passengerTickets.push(this.fb.group({
      name: new FormControl(name, { nonNullable: true }),
      ticket: new FormControl(ticket, { nonNullable: true }),
    }));
  }

  removePassengerTicket(index: number) {
    this.passengerTickets.removeAt(index);
  }

  get connections(): FormArray<FormGroup> {
    return this.form.controls.connections;
  }

  /** Add a connecting-flight row: layover airport + onward flight info. */
  addConnection(airport = '', flightNumber = '', departTime = '') {
    this.connections.push(this.fb.group({
      airport: new FormControl(airport, { nonNullable: true }),
      flightNumber: new FormControl(flightNumber ?? '', { nonNullable: true }),
      departTime: new FormControl(departTime ?? '', { nonNullable: true }),
    }));
  }

  removeConnection(index: number) {
    this.connections.removeAt(index);
  }

  /** Step 1: pick the type, then reveal the rest of the form. */
  chooseType(type: BookingType) {
    this.form.patchValue({ type });
    this.selectedType.set(type);
    this.typeChosen.set(true);
  }

  /** Allow going back to the type picker for a new booking. */
  backToTypes() {
    if (!this.isEdit) this.typeChosen.set(false);
  }

  onTypeChange(type: BookingType) {
    this.selectedType.set(type);
  }

  /** Look up live flight status and fold the times back into the form. */
  checkFlightStatus() {
    const flightNumber = (this.form.value.flightNumber ?? '').trim();
    if (!flightNumber) {
      this.statusMessage.set('Enter a flight number first (e.g. DL123).');
      return;
    }
    this.statusLoading.set(true);
    this.statusMessage.set(null);

    const dep = this.form.value.checkIn;
    const date = dep ? toDateStr(dep) : undefined;

    this.flightService.getStatus(flightNumber, date).subscribe(res => {
      this.statusLoading.set(false);
      if (res.error) { this.statusMessage.set(res.error); return; }
      if (res.configured === false) { this.statusMessage.set(res.message ?? 'Flight tracking is not configured.'); return; }
      if (!res.found || !res.status) { this.statusMessage.set(notFoundMessage(dep ?? null)); return; }

      const s = res.status;
      this.statusResult.set(s);

      // Fold the best-known times into the form so the booking reflects reality.
      const bestDep = s.actualDeparture ?? s.estimatedDeparture ?? s.scheduledDeparture;
      const bestArr = s.actualArrival ?? s.estimatedArrival ?? s.scheduledArrival;
      const patch: Record<string, unknown> = {};
      if (bestDep) { patch['checkIn'] = new Date(bestDep); patch['checkInTime'] = toTimeStr(new Date(bestDep)); }
      if (bestArr) { patch['checkOut'] = new Date(bestArr); patch['checkOutTime'] = toTimeStr(new Date(bestArr)); }
      if (s.departureAirport && !this.form.value.departureAirport) patch['departureAirport'] = s.departureAirport;
      if (s.arrivalAirport && !this.form.value.arrivalAirport) patch['arrivalAirport'] = s.arrivalAirport;
      if (s.airline && !this.form.value.provider) patch['provider'] = s.airline;
      this.form.patchValue(patch);
    });
  }

  submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    const v = this.form.value;
    const isFlight = v.type === 'flight';

    const checkIn = combine(v.checkIn ?? null, v.checkInTime ?? null);
    const checkOut = combine(v.checkOut ?? null, v.checkOutTime ?? null);

    const payload: Omit<Booking, 'id' | 'createdAt'> = {
      tripId: this.data.tripId,
      type: v.type!,
      title: v.title!,
      provider: v.provider ?? undefined,
      confirmationNumber: v.confirmationNumber ?? undefined,
      bookingUrl: v.bookingUrl ?? undefined,
      checkIn: checkIn ? Timestamp.fromDate(checkIn) : undefined,
      checkOut: checkOut ? Timestamp.fromDate(checkOut) : undefined,
      cost: v.cost ? Number(v.cost) : undefined,
      currency: v.currency ?? undefined,
      status: v.status!,
      notes: v.notes ?? undefined,
      passengerIds: (v.passengerIds as string[])?.length ? (v.passengerIds as string[]) : undefined,
      paidById: v.paidById ?? null,
      flightNumber: isFlight && v.flightNumber ? v.flightNumber.trim().toUpperCase() : undefined,
      passengerTickets: isFlight ? cleanPassengerTickets(this.passengerTickets.value) : undefined,
      departureAirport: isFlight && v.departureAirport ? v.departureAirport.trim().toUpperCase() : undefined,
      arrivalAirport: isFlight && v.arrivalAirport ? v.arrivalAirport.trim().toUpperCase() : undefined,
      connections: isFlight ? cleanConnections(this.connections.value) : undefined,
      layovers: isFlight ? deriveLayovers(this.connections.value) : undefined,
      flightStatus: isFlight && this.statusResult() ? toFlightStatus(this.statusResult()!) : undefined,
    };

    const op: Observable<void> = this.isEdit
      ? from(this.bookingService.updateBooking(this.data.booking!.id!, payload))
      : from(this.bookingService.createBooking(payload)).pipe(map(() => undefined));

    op.subscribe({
      next: () => this.dialogRef.close(true),
      error: (err) => {
        this.loading.set(false);
        this.snackBar.open(
          err?.message ? `Couldn't save: ${err.message}` : 'Couldn\'t save booking. Please try again.',
          'Dismiss',
          { duration: 6000 },
        );
      },
    });
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function toTimeStr(d?: Date | null): string {
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface ConnectionRow { airport?: string; flightNumber?: string; departTime?: string }

/** Keep connection rows that have a layover airport; trim/uppercase; undefined if none. */
function cleanConnections(rows: ConnectionRow[]): { airport: string; flightNumber?: string; departTime?: string }[] | undefined {
  const out = rows
    .map(r => ({
      airport: (r.airport ?? '').trim().toUpperCase(),
      flightNumber: (r.flightNumber ?? '').trim().toUpperCase() || undefined,
      departTime: (r.departTime ?? '').trim() || undefined,
    }))
    .filter(r => r.airport);
  return out.length ? out : undefined;
}

/** The layover airport list (for the route display), derived from connections. */
function deriveLayovers(rows: ConnectionRow[]): string[] | undefined {
  const out = rows.map(r => (r.airport ?? '').trim().toUpperCase()).filter(Boolean);
  return out.length ? out : undefined;
}

/** Keep rows that have a name or a ticket; trim values; undefined if none. */
function cleanPassengerTickets(
  rows: { name?: string; ticket?: string }[],
): { name: string; ticket: string }[] | undefined {
  const out = rows
    .map(r => ({ name: (r.name ?? '').trim(), ticket: (r.ticket ?? '').trim() }))
    .filter(r => r.name || r.ticket);
  return out.length ? out : undefined;
}

/** A friendlier "no status" message that accounts for flights too far out to track. */
function notFoundMessage(departure: Date | null): string {
  if (departure) {
    const days = Math.ceil((departure.getTime() - Date.now()) / 86400000);
    if (days > 3) {
      return `Flight status not available yet — departure is ${days} days out. Airlines usually publish live tracking 1–3 days before the flight, so check back closer to the date.`;
    }
    if (days < -1) {
      return 'No live status — this flight has already departed and is no longer tracked.';
    }
  }
  return 'Flight not found — double-check the flight number and departure date.';
}

/** Merge a date and an "HH:mm" string into a single Date. */
function combine(date: Date | null, time: string | null): Date | null {
  if (!date) return null;
  const d = new Date(date);
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

function toFlightStatus(s: FlightStatusResult): FlightStatus {
  return {
    flightStatus: s.flightStatus,
    airline: s.airline,
    flightNumber: s.flightNumber,
    departureAirport: s.departureAirport,
    arrivalAirport: s.arrivalAirport,
    scheduledDeparture: s.scheduledDeparture,
    estimatedDeparture: s.estimatedDeparture,
    actualDeparture: s.actualDeparture,
    scheduledArrival: s.scheduledArrival,
    estimatedArrival: s.estimatedArrival,
    actualArrival: s.actualArrival,
    departureTerminal: s.departureTerminal,
    departureGate: s.departureGate,
    arrivalTerminal: s.arrivalTerminal,
    arrivalGate: s.arrivalGate,
    departureDelayMinutes: s.departureDelayMinutes,
    arrivalDelayMinutes: s.arrivalDelayMinutes,
    updatedAt: Timestamp.now(),
  };
}

/** Reverse of toFlightStatus, for pre-loading a saved status into the lookup UI. */
function toResult(s: FlightStatus): FlightStatusResult {
  return {
    flightStatus: s.flightStatus,
    airline: s.airline,
    flightNumber: s.flightNumber,
    departureAirport: s.departureAirport,
    arrivalAirport: s.arrivalAirport,
    scheduledDeparture: s.scheduledDeparture,
    estimatedDeparture: s.estimatedDeparture,
    actualDeparture: s.actualDeparture,
    scheduledArrival: s.scheduledArrival,
    estimatedArrival: s.estimatedArrival,
    actualArrival: s.actualArrival,
    departureTerminal: s.departureTerminal,
    departureGate: s.departureGate,
    arrivalTerminal: s.arrivalTerminal,
    arrivalGate: s.arrivalGate,
    departureDelayMinutes: s.departureDelayMinutes,
    arrivalDelayMinutes: s.arrivalDelayMinutes,
    source: 'saved',
  };
}
