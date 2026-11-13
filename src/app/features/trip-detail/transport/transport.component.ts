import { Component, Input, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { TransportService, Journey, LocalOption, NearbyStop } from '../../../core/services/transport.service';
import { ItineraryService } from '../../../core/services/itinerary.service';
import { BookingService } from '../../../core/services/booking.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { AuthService } from '../../../core/services/auth.service';

export interface SearchSite {
  name: string;
  icon: string;       // Material icon fallback
  color: string;
  url: () => string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-transport',
  standalone: true,
  imports: [
    FormsModule,
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
  private auth             = inject(AuthService);

  /** Whether the current user may edit the schedule directly (vs. propose). */
  private canEditSchedule(): boolean {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.trip) return false;
    return this.trip.userId === uid
      || (this.trip.ownerIds ?? []).includes(uid)
      || (this.trip.scheduleEditorIds ?? []).includes(uid);
  }

  // ── Mode toggle ───────────────────────────────────────────
  searchMode = signal<'trains' | 'flights' | 'hotels'>('trains');

  // ── Train search ──────────────────────────────────────────
  origin      = signal('');
  destination = signal('');
  departure   = signal('');
  searching   = signal(false);
  journeys    = signal<Journey[]>([]);
  trainError  = signal('');
  fromStation = signal('');
  toStation   = signal('');

  // ── Flight search inputs ──────────────────────────────────
  flightOrigin      = signal('');
  flightDestination = signal('');
  flightDate        = signal('');

  // ── Hotel search inputs ───────────────────────────────────
  hotelDestination = signal('');
  hotelCheckIn     = signal('');
  hotelCheckOut    = signal('');

  // ── Local transport ───────────────────────────────────────
  loadingLocal = signal(false);
  localSummary = signal<LocalOption[]>([]);
  nearbyStops  = signal<NearbyStop[]>([]);

  // ── AI plan ───────────────────────────────────────────────
  loadingPlan = signal(false);
  aiPlan      = signal('');

  // ── UI state ──────────────────────────────────────────────
  showStops = signal(false);
  savedLocalOptions = signal<Set<string>>(new Set());

  ngOnInit() {
    this.destination.set(this.trip.destination);
    this.flightDestination.set(this.trip.destination);
    this.hotelDestination.set(this.trip.destination);
    const d   = this.trip.startDate.toDate();
    const end = this.trip.endDate.toDate();
    this.departure.set(d.toISOString().slice(0, 16));
    this.flightDate.set(d.toISOString().slice(0, 10));
    this.hotelCheckIn.set(d.toISOString().slice(0, 10));
    this.hotelCheckOut.set(end.toISOString().slice(0, 10));
    this.geocodeAndLoadLocal(this.trip.destination);
  }

  // ── External flight search sites ──────────────────────────

  get flightSites(): SearchSite[] {
    const o    = encodeURIComponent(this.flightOrigin() || this.trip.destination);
    const d    = encodeURIComponent(this.flightDestination() || this.trip.destination);
    const date = this.flightDate() || this.trip.startDate.toDate().toISOString().slice(0, 10);
    // Skyscanner wants YYMMDD
    const ssDate = date.replace(/-/g, '').slice(2);
    // Kayak wants YYYY-MM-DD (already that format)
    const raw  = this.flightOrigin() || '';
    const rawD = this.flightDestination() || '';

    return [
      {
        name:  'Google Flights',
        icon:  'flight',
        color: '#4285F4',
        url: () =>
          `https://www.google.com/travel/flights?q=Flights+from+${o}+to+${d}+on+${encodeURIComponent(date)}`,
      },
      {
        name:  'Skyscanner',
        icon:  'search',
        color: '#0770E3',
        url: () =>
          `https://www.skyscanner.com/transport/flights/${encodeURIComponent(raw)}/${encodeURIComponent(rawD)}/${ssDate}/`,
      },
      {
        name:  'Kayak',
        icon:  'compare_arrows',
        color: '#FF690F',
        url: () =>
          `https://www.kayak.com/flights/${encodeURIComponent(raw)}-${encodeURIComponent(rawD)}/${date}`,
      },
      {
        name:  'Expedia',
        icon:  'luggage',
        color: '#00355F',
        url: () =>
          `https://www.expedia.com/Flights-Search?trip=oneway&leg1=from:${o},to:${d},departure:${date}TANYT`,
      },
    ];
  }

  // ── External hotel search sites ───────────────────────────

  get hotelSites(): SearchSite[] {
    const dest    = encodeURIComponent(this.hotelDestination() || this.trip.destination);
    const checkIn  = this.hotelCheckIn()  || this.trip.startDate.toDate().toISOString().slice(0, 10);
    const checkOut = this.hotelCheckOut() || this.trip.endDate.toDate().toISOString().slice(0, 10);

    return [
      {
        name:  'Booking.com',
        icon:  'hotel',
        color: '#003580',
        url: () =>
          `https://www.booking.com/searchresults.html?ss=${dest}&checkin=${checkIn}&checkout=${checkOut}&group_adults=2&no_rooms=1`,
      },
      {
        name:  'Google Hotels',
        icon:  'bed',
        color: '#4285F4',
        url: () =>
          `https://www.google.com/travel/hotels?q=hotels+in+${dest}&checkin=${checkIn}&checkout=${checkOut}`,
      },
      {
        name:  'Airbnb',
        icon:  'house',
        color: '#FF5A5F',
        url: () =>
          `https://www.airbnb.com/s/${dest}/homes?checkin=${checkIn}&checkout=${checkOut}`,
      },
      {
        name:  'Hostelworld',
        icon:  'group',
        color: '#F37012',
        url: () =>
          `https://www.hostelworld.com/s?q=${dest}&checkIn=${checkIn}&checkOut=${checkOut}`,
      },
    ];
  }

  openSite(site: SearchSite) {
    window.open(site.url(), '_blank', 'noopener');
  }

  // ── Train search ──────────────────────────────────────────

  searchTrains() {
    const o   = this.origin().trim();
    const d   = this.destination().trim();
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

  addJourneyToItinerary(j: Journey) {
    const dep    = j.departure ? new Date(j.departure) : this.trip.startDate.toDate();
    const label  = j.legs.map(l => [l.from, l.to].filter(Boolean).join(' → ')).join(' | ');
    const timeStr = j.departure ? new Date(j.departure).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined;
    const endStr  = j.arrival   ? new Date(j.arrival).toLocaleTimeString('en-US',   { hour: '2-digit', minute: '2-digit' }) : undefined;

    from(this.itineraryService.createItem({
      tripId:    this.tripId,
      title:     `Train: ${this.fromStation() || this.origin()} → ${this.toStation() || this.destination()}`,
      category:  'transport',
      date:      Timestamp.fromDate(dep),
      startTime: timeStr,
      endTime:   endStr,
      description: `${j.duration ?? ''} · ${j.changes} change${j.changes !== 1 ? 's' : ''}. ${label}`,
      order: 0,
      // Non-editors can only create proposed items (Firestore rules enforce this).
      ...(this.canEditSchedule()
        ? {}
        : { proposed: true, proposedBy: this.auth.currentUser?.uid }),
    })).subscribe(() =>
      this.snackBar.open(
        this.canEditSchedule() ? 'Train journey added to schedule' : 'Train journey proposed — sent for approval',
        undefined, { duration: 2500 })
    );
  }

  // ── Local transport ───────────────────────────────────────

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

  saveLocalOptionAsBooking(option: LocalOption) {
    const key = option.type;
    from(this.bookingService.createBooking({
      tripId: this.tripId,
      type:   option.type === 'Car Rental' || option.type === 'Car Sharing' ? 'car-rental' : 'other',
      title:  `${option.type} near ${this.trip.destination}`,
      status: 'suggested',
      notes:  `SUGGESTION — not yet booked. ${option.count} ${option.type} location${option.count !== 1 ? 's' : ''} found near your destination. Research and book before travelling.`,
    })).subscribe(() => {
      this.savedLocalOptions.update(s => new Set([...s, key]));
      this.snackBar.open(`${option.type} saved as suggestion in Bookings`, undefined, { duration: 2500 });
    });
  }

  // ── AI plan ───────────────────────────────────────────────

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

  // ── Helpers ───────────────────────────────────────────────

  modeIcon(mode: string): string {
    if (['train', 'nationalExpress', 'national', 'regional'].includes(mode)) return 'train';
    if (mode === 'bus')     return 'directions_bus';
    if (mode === 'tram')    return 'tram';
    if (mode === 'subway' || mode === 'metro') return 'subway';
    if (mode === 'walking') return 'directions_walk';
    return 'directions_transit';
  }

  localIcon(type: string): string {
    const map: Record<string, string> = {
      'Bike Share':           'pedal_bike',
      'Bus':                  'directions_bus',
      'Tram':                 'tram',
      'Subway / Metro':       'subway',
      'Taxi Stand':           'local_taxi',
      'Car Rental':           'directions_car',
      'Car Sharing':          'car_rental',
      'Scooter / Moto Rental':'two_wheeler',
      'Ferry':                'directions_boat',
    };
    return map[type] ?? 'directions_transit';
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
