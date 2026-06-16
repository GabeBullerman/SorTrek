import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Timestamp } from '@angular/fire/firestore';
import { from } from 'rxjs';
import { Trip } from '../../../core/models/trip.model';
import { TransportService, Journey, FlightOffer, HotelOffer, LocalOption, NearbyStop } from '../../../core/services/transport.service';
import { ItineraryService } from '../../../core/services/itinerary.service';
import { BookingService } from '../../../core/services/booking.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';

@Component({
  selector: 'app-transport',
  standalone: true,
  imports: [
    FormsModule, DatePipe, DecimalPipe, TitleCasePipe,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatChipsModule, MatTooltipModule, MatButtonToggleModule,
  ],
  templateUrl: './transport.component.html',
  styleUrl: './transport.component.scss',
})
export class TransportComponent implements OnInit {
  @Input() trip!: Trip;
  @Input() tripId!: string;

  private transportService = inject(TransportService);
  private itineraryService = inject(ItineraryService);
  private bookingService   = inject(BookingService);
  private mapsLoader       = inject(GoogleMapsLoaderService);
  private snackBar         = inject(MatSnackBar);

  // ── Mode toggle ───────────────────────────────────────────
  searchMode = signal<'trains' | 'flights' | 'hotels'>('trains');

  // ── Train search ──────────────────────────────────────────
  origin       = signal('');
  destination  = signal('');
  departure    = signal('');
  searching    = signal(false);
  journeys     = signal<Journey[]>([]);
  trainError   = signal('');
  fromStation  = signal('');
  toStation    = signal('');

  // ── Flight search ─────────────────────────────────────────
  flightOrigin      = signal('');
  flightDestination = signal('');
  flightDate        = signal('');
  searchingFlights  = signal(false);
  flights           = signal<FlightOffer[]>([]);
  flightError       = signal('');
  fromAirport       = signal('');
  toAirport         = signal('');

  // ── Hotel search ──────────────────────────────────────────
  hotelDestination = signal('');
  hotelCheckIn     = signal('');
  hotelCheckOut    = signal('');
  searchingHotels  = signal(false);
  hotels           = signal<HotelOffer[]>([]);
  hotelError       = signal('');
  hotelCityCode    = signal('');

  // ── Local transport ───────────────────────────────────────
  loadingLocal = signal(false);
  localSummary = signal<LocalOption[]>([]);
  nearbyStops  = signal<NearbyStop[]>([]);

  // ── AI plan ───────────────────────────────────────────────
  loadingPlan = signal(false);
  aiPlan      = signal('');

  // ── UI state ──────────────────────────────────────────────
  showStops   = signal(false);

  // Track which local options have been saved as bookings
  savedLocalOptions = signal<Set<string>>(new Set());

  ngOnInit() {
    this.destination.set(this.trip.destination);
    this.flightDestination.set(this.trip.destination);
    this.hotelDestination.set(this.trip.destination);
    const d    = this.trip.startDate.toDate();
    const end  = this.trip.endDate.toDate();
    const dateStr = d.toISOString().slice(0, 16);
    this.departure.set(dateStr);
    this.flightDate.set(d.toISOString().slice(0, 10));
    this.hotelCheckIn.set(d.toISOString().slice(0, 10));
    this.hotelCheckOut.set(end.toISOString().slice(0, 10));
    this.geocodeAndLoadLocal(this.trip.destination);
  }

  private geocodeAndLoadLocal(place: string) {
    this.mapsLoader.load().subscribe(loaded => {
      if (!loaded) return;
      const geocoder = new (window as any).google.maps.Geocoder();
      geocoder.geocode({ address: place }, (results: any[], status: string) => {
        if (status === 'OK' && results?.[0]) {
          const loc = results[0].geometry.location;
          this.fetchLocal(loc.lat(), loc.lng());
        }
      });
    });
  }

  private fetchLocal(lat: number, lon: number) {
    this.loadingLocal.set(true);
    this.transportService.getLocalOptions(lat, lon).subscribe(data => {
      this.localSummary.set(data.localSummary ?? []);
      this.nearbyStops.set(data.nearbyStops ?? []);
      this.loadingLocal.set(false);
    });
  }

  searchTrains() {
    const o = this.origin().trim();
    const d = this.destination().trim();
    const dep = this.departure();
    if (!o || !d || !dep) return;

    this.searching.set(true);
    this.journeys.set([]);
    this.trainError.set('');

    this.transportService.searchTrains(o, d, dep).subscribe(result => {
      this.searching.set(false);
      if (result.error) { this.trainError.set(result.error); return; }
      this.journeys.set(result.journeys ?? []);
      if (result.fromStation?.name) this.fromStation.set(result.fromStation.name);
      if (result.toStation?.name)   this.toStation.set(result.toStation.name);
      if (!result.journeys?.length) this.trainError.set('No trains found for this route and date.');
    });
  }

  searchFlights() {
    const o = this.flightOrigin().trim();
    const d = this.flightDestination().trim();
    const date = this.flightDate();
    if (!o || !d || !date) return;

    this.searchingFlights.set(true);
    this.flights.set([]);
    this.flightError.set('');

    this.transportService.searchFlights(o, d, date).subscribe(result => {
      this.searchingFlights.set(false);
      if (result.error) { this.flightError.set(result.error); return; }
      this.flights.set(result.flights ?? []);
      if (result.fromAirport) this.fromAirport.set(`${result.fromAirport.name} (${result.fromAirport.code})`);
      if (result.toAirport)   this.toAirport.set(`${result.toAirport.name} (${result.toAirport.code})`);
      if (!result.flights?.length) this.flightError.set('No flights found for this route and date.');
    });
  }

  searchHotels() {
    const dest     = this.hotelDestination().trim();
    const checkIn  = this.hotelCheckIn();
    const checkOut = this.hotelCheckOut();
    if (!dest || !checkIn || !checkOut) return;

    this.searchingHotels.set(true);
    this.hotels.set([]);
    this.hotelError.set('');

    this.transportService.searchHotels(dest, checkIn, checkOut).subscribe(result => {
      this.searchingHotels.set(false);
      if (result.error) { this.hotelError.set(result.error); return; }
      this.hotels.set(result.hotels ?? []);
      if (result.cityCode) this.hotelCityCode.set(result.cityCode);
      if (!result.hotels?.length) this.hotelError.set('No hotel offers found for this destination and dates.');
    });
  }

  saveHotelAsBooking(h: HotelOffer) {
    const checkInDate  = h.checkIn  ? Timestamp.fromDate(new Date(h.checkIn))  : undefined;
    const checkOutDate = h.checkOut ? Timestamp.fromDate(new Date(h.checkOut)) : undefined;
    const priceStr = h.price ? `${h.price.currency} ${h.price.amount.toFixed(2)}` : '';
    const starStr  = h.rating ? ` (${h.rating}-star)` : '';

    from(this.bookingService.createBooking({
      tripId: this.tripId,
      type: 'hotel',
      title: `${h.hotelName}${starStr}`,
      status: 'suggested',
      ...(checkInDate  ? { checkIn:  checkInDate }  : {}),
      ...(checkOutDate ? { checkOut: checkOutDate } : {}),
      ...(h.price ? { cost: h.price.amount, currency: h.price.currency } : {}),
      notes: `SUGGESTION — not yet booked. ${priceStr ? 'Shown price: ' + priceStr + '. ' : ''}${h.roomType ? 'Room: ' + h.roomType + '. ' : ''}${h.boardType ? 'Board: ' + h.boardType + '. ' : ''}Verify availability and book directly on hotel site. Powered by Amadeus test API.`,
    })).subscribe(() =>
      this.snackBar.open('Hotel saved as suggestion in Bookings', undefined, { duration: 2500 })
    );
  }

  getAIPlan() {
    this.loadingPlan.set(true);
    this.aiPlan.set('');
    this.transportService.getAIPlan(
      this.trip.name,
      this.destination(),
      this.journeys(),
      this.localSummary(),
    ).subscribe(plan => {
      this.aiPlan.set(plan);
      this.loadingPlan.set(false);
    });
  }

  addJourneyToItinerary(j: Journey) {
    const dep = j.departure ? new Date(j.departure) : this.trip.startDate.toDate();
    const label = j.legs.map(l => [l.from, l.to].filter(Boolean).join(' → ')).join(' | ');
    const timeStr = j.departure ? new Date(j.departure).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined;
    const endStr  = j.arrival  ? new Date(j.arrival).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined;

    from(this.itineraryService.createItem({
      tripId: this.tripId,
      title: `Train: ${this.fromStation() || this.origin()} → ${this.toStation() || this.destination()}`,
      category: 'transport',
      date: Timestamp.fromDate(dep),
      startTime: timeStr,
      endTime: endStr,
      description: `${j.duration ?? ''} · ${j.changes} change${j.changes !== 1 ? 's' : ''}. ${label}`,
      order: 0,
    })).subscribe(() =>
      this.snackBar.open('Train journey added to schedule', undefined, { duration: 2500 })
    );
  }

  saveFlightAsBooking(f: FlightOffer) {
    const depDate = f.departure ? Timestamp.fromDate(new Date(f.departure)) : undefined;
    const arrDate = f.arrival   ? Timestamp.fromDate(new Date(f.arrival))   : undefined;
    const priceStr = f.price ? `${f.price.currency} ${f.price.amount.toFixed(2)}` : '';

    from(this.bookingService.createBooking({
      tripId: this.tripId,
      type: 'flight',
      title: `Flight ${f.flightNumber}: ${f.originCode} → ${f.destinationCode}`,
      provider: f.airline ?? undefined,
      status: 'suggested',
      ...(depDate ? { checkIn: depDate }   : {}),
      ...(arrDate ? { checkOut: arrDate }  : {}),
      ...(f.price ? { cost: f.price.amount, currency: f.price.currency } : {}),
      notes: `SUGGESTION — not yet booked. ${priceStr ? 'Shown price: ' + priceStr + '. ' : ''}Confirm booking and update status when purchased.`,
    })).subscribe(() =>
      this.snackBar.open('Flight saved as suggestion in Bookings', undefined, { duration: 2500 })
    );
  }

  saveLocalOptionAsBooking(option: LocalOption) {
    const key = option.type;
    from(this.bookingService.createBooking({
      tripId: this.tripId,
      type: option.type === 'Car Rental' || option.type === 'Car Sharing' ? 'car-rental' : 'other',
      title: `${option.type} near ${this.trip.destination}`,
      status: 'suggested',
      notes: `SUGGESTION — not yet booked. ${option.count} ${option.type} location${option.count !== 1 ? 's' : ''} found near your destination. Research and book before travelling.`,
    })).subscribe(() => {
      this.savedLocalOptions.update(s => new Set([...s, key]));
      this.snackBar.open(`${option.type} saved as suggestion in Bookings`, undefined, { duration: 2500 });
    });
  }

  modeIcon(mode: string): string {
    if (mode === 'train' || mode === 'nationalExpress' || mode === 'national' || mode === 'regional') return 'train';
    if (mode === 'bus')   return 'directions_bus';
    if (mode === 'tram')  return 'tram';
    if (mode === 'subway' || mode === 'metro') return 'subway';
    if (mode === 'walking') return 'directions_walk';
    return 'directions_transit';
  }

  localIcon(type: string): string {
    if (type === 'Bike Share')               return 'pedal_bike';
    if (type === 'Bus')                      return 'directions_bus';
    if (type === 'Tram')                     return 'tram';
    if (type === 'Subway / Metro')           return 'subway';
    if (type === 'Taxi Stand')               return 'local_taxi';
    if (type === 'Car Rental')               return 'directions_car';
    if (type === 'Car Sharing')              return 'car_rental';
    if (type === 'Scooter / Moto Rental')    return 'two_wheeler';
    if (type === 'Ferry')                    return 'directions_boat';
    return 'directions_transit';
  }

  formatTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
