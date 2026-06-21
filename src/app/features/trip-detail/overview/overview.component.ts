import { Component, Input, OnInit, inject, signal, effect, untracked } from '@angular/core';
import { AsyncPipe, DatePipe, CurrencyPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { GoogleMap, MapMarker, MapInfoWindow, MapDirectionsService, MapDirectionsRenderer } from '@angular/google-maps';
import { Observable, of, catchError, tap } from 'rxjs';
import { Trip } from '../../../core/models/trip.model';
import { ItineraryService } from '../../../core/services/itinerary.service';
import { BookingService } from '../../../core/services/booking.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { WeatherService, WeatherDay } from '../../../core/services/weather.service';
import { CardReminderService } from '../../../core/services/card-reminder.service';
import { PushNotificationService } from '../../../core/services/push-notification.service';
import { MoneyComponent } from '../../../shared/components/money/money.component';
import { ItineraryItem } from '../../../core/models/itinerary-item.model';
import { Booking } from '../../../core/models/booking.model';

export interface MapPin {
  position: google.maps.LatLngLiteral;
  item: ItineraryItem;
}

export interface TripDay {
  date: Date;
  iso: string;
  label: string;
  dayNum: number;
}

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [
    AsyncPipe, DatePipe, CurrencyPipe, FormsModule,
    MatCardModule, MatIconModule, MatButtonModule,
    MatSelectModule, MatFormFieldModule, MatProgressSpinnerModule, MatTooltipModule,
    GoogleMap, MapMarker, MapInfoWindow, MapDirectionsRenderer,
    MoneyComponent,
  ],
  providers: [MapDirectionsService],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
})
export class OverviewComponent implements OnInit {
  @Input() trip!: Trip;
  @Input() tripId!: string;

  private itineraryService = inject(ItineraryService);
  private bookingService = inject(BookingService);
  private directionsService = inject(MapDirectionsService);
  private mapsLoader = inject(GoogleMapsLoaderService);
  private weatherService = inject(WeatherService);
  private cardReminderService = inject(CardReminderService);
  private pushNotificationService = inject(PushNotificationService);
  private snackBar = inject(MatSnackBar);

  items$!: Observable<ItineraryItem[]>;
  bookings$!: Observable<Booking[]>;
  mapApiLoaded$!: Observable<boolean>;

  weather = signal<WeatherDay[]>([]);
  showCardReminder = signal(false);
  remindersEnabled = signal(false);
  activePin = signal<ItineraryItem | null>(null);
  allItems = signal<ItineraryItem[]>([]);
  selectedDayIso = signal<string>('');
  mapsLoaded = signal(false);
  travelMode = signal<string>('DRIVING');
  directionsResult = signal<google.maps.DirectionsResult | undefined>(undefined);
  routeLegs = signal<google.maps.DirectionsLeg[]>([]);
  loadingRoute = signal(false);
  private geocodeAttempted = false;

  readonly rendererOptions: google.maps.DirectionsRendererOptions = {
    suppressMarkers: true,
    preserveViewport: false,
    polylineOptions: { strokeColor: '#1a237e', strokeWeight: 5, strokeOpacity: 0.8 },
  };

  readonly travelModes = [
    { value: 'WALKING', label: 'Walking', icon: 'directions_walk' },
    { value: 'DRIVING', label: 'Driving', icon: 'directions_car' },
    { value: 'TRANSIT', label: 'Transit', icon: 'directions_transit' },
    { value: 'BICYCLING', label: 'Cycling', icon: 'directions_bike' },
  ];

  mapOptions: google.maps.MapOptions = {
    zoom: 10,
    mapTypeId: 'roadmap',
    disableDefaultUI: false,
    streetViewControl: false,
  };

  mapCenter = signal<google.maps.LatLngLiteral>({ lat: 0, lng: 0 });

  // ── Accommodation / located bookings on the map ──────────────────
  allBookings = signal<Booking[]>([]);
  bookingPins = signal<{ position: google.maps.LatLngLiteral; booking: Booking }[]>([]);
  activeBookingPin = signal<Booking | null>(null);
  private bookingGeocodeCache = new Map<string, google.maps.LatLngLiteral>();

  constructor() {
    effect(() => {
      const loaded = this.mapsLoaded();
      const dayIso = this.selectedDayIso();
      const items = this.allItems();
      const mode = this.travelMode();
      if (!loaded) return;
      if (!this.geocodeAttempted && items.filter(i => i.latitude && i.longitude).length === 0) {
        this.geocodeAttempted = true;
        untracked(() => this.geocodeDestination());
      }
      if (!dayIso) return;
      untracked(() => this.computeRoute(this.getDayRoute(dayIso, items), mode));
    });

    // Geocode located bookings (hotels/rentals/etc.) for map markers.
    effect(() => {
      const loaded = this.mapsLoaded();
      const bookings = this.allBookings();
      if (!loaded) return;
      untracked(() => this.geocodeBookings(bookings));
    });
  }

  ngOnInit() {
    this.items$ = this.itineraryService.getItems(this.tripId).pipe(
      catchError(() => of([])),
      tap(items => {
        this.allItems.set(items);
        const located = items.filter(i => i.latitude && i.longitude);
        if (located.length > 0) {
          const lat = located.reduce((s, i) => s + i.latitude!, 0) / located.length;
          const lng = located.reduce((s, i) => s + i.longitude!, 0) / located.length;
          this.mapCenter.set({ lat, lng });
        }
      })
    );
    this.bookings$ = this.bookingService.getBookings(this.tripId).pipe(
      catchError(() => of([])),
      tap(bookings => this.allBookings.set(bookings)),
    );
    this.mapApiLoaded$ = this.mapsLoader.load().pipe(
      tap(loaded => { if (loaded) this.mapsLoaded.set(true); })
    );

    this.weatherService.getForecast(this.trip.destination)
      .subscribe(days => this.weather.set(days));

    if (
      this.cardReminderService.shouldRemind(this.trip) &&
      !this.cardReminderService.isDismissed(this.tripId)
    ) {
      this.showCardReminder.set(true);
    }
  }

  get daysUntilTrip(): number {
    return Math.ceil((this.trip.startDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  dismissReminder(): void {
    this.cardReminderService.dismiss(this.tripId);
    this.showCardReminder.set(false);
  }

  async enableReminders(): Promise<void> {
    const granted = await this.pushNotificationService.requestPermission();
    if (granted) {
      this.cardReminderService.scheduleNotification(this.trip, this.pushNotificationService);
      this.remindersEnabled.set(true);
      this.snackBar.open('Reminders enabled — you\'ll be notified 48 h before departure', undefined, { duration: 3500 });
    } else {
      this.snackBar.open('Notification permission denied', undefined, { duration: 2500 });
    }
  }

  tripDayNumber(date: Date): number | null {
    const start = this.trip.startDate.toDate();
    const end   = this.trip.endDate.toDate();
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (d < start || d > end) return null;
    return Math.round((d.getTime() - start.getTime()) / 86400000) + 1;
  }

  get tripDays(): TripDay[] {
    const days: TripDay[] = [];
    const start = new Date(this.trip.startDate.toDate());
    const end = new Date(this.trip.endDate.toDate());
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const cur = new Date(start);
    let num = 1;
    while (cur <= end) {
      days.push({
        date: new Date(cur),
        iso: cur.toISOString().split('T')[0],
        label: `Day ${num} — ${cur.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
        dayNum: num,
      });
      cur.setDate(cur.getDate() + 1);
      num++;
    }
    return days;
  }

  getDayRoute(dayIso: string, items?: ItineraryItem[]): ItineraryItem[] {
    const src = items ?? this.allItems();
    return src
      .filter(i => i.date?.toDate().toISOString().split('T')[0] === dayIso)
      .sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  private geocodeDestination(): void {
    if (!this.trip?.destination) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: this.trip.destination }, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        this.mapCenter.set({ lat: loc.lat(), lng: loc.lng() });
      }
    });
  }

  /** Geocode located bookings (accommodations etc.) so they show as map pins.
   *  Uses the booking's address, falling back to "title, destination". */
  private geocodeBookings(bookings: Booking[]): void {
    const located = bookings.filter(b =>
      b.type !== 'flight' && b.status !== 'cancelled' &&
      (!!b.address?.trim() || b.type === 'hotel' || b.type === 'airbnb'));
    if (!located.length) { this.bookingPins.set([]); return; }

    const geocoder = new google.maps.Geocoder();
    const pins: { position: google.maps.LatLngLiteral; booking: Booking }[] = [];
    let pending = located.length;
    const finish = () => { if (--pending === 0) this.bookingPins.set([...pins]); };

    for (const b of located) {
      const query = b.address?.trim() || `${b.title}, ${this.trip.destination}`;
      const cached = this.bookingGeocodeCache.get(query);
      if (cached) { pins.push({ position: cached, booking: b }); finish(); continue; }
      geocoder.geocode({ address: query }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          const pos = { lat: loc.lat(), lng: loc.lng() };
          this.bookingGeocodeCache.set(query, pos);
          pins.push({ position: pos, booking: b });
        }
        finish();
      });
    }
  }

  /** Build a teardrop map-pin icon with an emoji glyph in a coloured pin. */
  private pinIcon(glyph: string, color: string): google.maps.Icon {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">' +
      `<path d="M20 0C9 0 0 9 0 20c0 14 20 28 20 28s20-14 20-28C40 9 31 0 20 0z" fill="${color}"/>` +
      '<circle cx="20" cy="19" r="13" fill="#ffffff"/>' +
      `<text x="20" y="25" font-size="16" text-anchor="middle">${glyph}</text></svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(40, 48),
      anchor: new google.maps.Point(20, 48),
    };
  }

  /** A teardrop pin with a type glyph (hotel/house/car) for a booking marker. */
  bookingMarkerOptions(booking: Booking): google.maps.MarkerOptions {
    const [glyph, color] =
      booking.type === 'hotel'      ? ['🏨', '#00897b'] :
      booking.type === 'airbnb'     ? ['🏠', '#5e35b1'] :
      booking.type === 'car-rental' ? ['🚗', '#1565c0'] : ['📍', '#546e7a'];
    return { title: booking.title, icon: this.pinIcon(glyph, color) };
  }

  /** Category-based pin for a scheduled plan: ticket/home/car/food/etc. */
  itineraryMarkerOptions(item: ItineraryItem): google.maps.MarkerOptions {
    const [glyph, color] =
      item.category === 'activity'      ? ['🎟️', '#00897b'] :
      item.category === 'accommodation' ? ['🏠', '#5e35b1'] :
      item.category === 'transport'     ? ['🚗', '#1565c0'] :
      item.category === 'food'          ? ['🍴', '#ef6c00'] : ['📍', '#546e7a'];
    return { title: item.title, icon: this.pinIcon(glyph, color) };
  }

  openBookingInfo(infoWindow: MapInfoWindow, marker: MapMarker, booking: Booking) {
    this.activeBookingPin.set(booking);
    infoWindow.open(marker);
  }

  private computeRoute(stops: ItineraryItem[], mode: string) {
    const located = stops.filter(i => i.latitude && i.longitude);
    if (located.length < 2) {
      this.directionsResult.set(undefined);
      this.routeLegs.set([]);
      return;
    }

    this.loadingRoute.set(true);

    const toLatLng = (i: ItineraryItem): google.maps.LatLngLiteral =>
      ({ lat: i.latitude!, lng: i.longitude! });

    const waypoints: google.maps.DirectionsWaypoint[] = located.slice(1, -1).map(i => ({
      location: toLatLng(i),
      stopover: true,
    }));

    this.directionsService.route({
      origin: toLatLng(located[0]),
      destination: toLatLng(located[located.length - 1]),
      waypoints,
      travelMode: mode as google.maps.TravelMode,
      optimizeWaypoints: false,
    }).subscribe(res => {
      this.loadingRoute.set(false);
      if (res.status === 'OK' && res.result) {
        this.directionsResult.set(res.result);
        this.routeLegs.set(res.result.routes[0]?.legs ?? []);
      } else {
        this.directionsResult.set(undefined);
        this.routeLegs.set([]);
      }
    });
  }

  getPins(items: ItineraryItem[]): MapPin[] {
    return items
      .filter(i => i.latitude && i.longitude)
      .map(i => ({ position: { lat: i.latitude!, lng: i.longitude! }, item: i }));
  }

  getVisiblePins(items: ItineraryItem[]): MapPin[] {
    const dayIso = this.selectedDayIso();
    const src = dayIso ? this.getDayRoute(dayIso, items) : items;
    return this.getPins(src);
  }

  openInfo(infoWindow: MapInfoWindow, marker: MapMarker, item: ItineraryItem) {
    this.activePin.set(item);
    infoWindow.open(marker);
  }

  totalCost(bookings: Booking[], items: ItineraryItem[]): number {
    const b = bookings.reduce((s, b) => s + (b.cost ?? 0), 0);
    const i = items.reduce((s, i) => s + (i.cost ?? 0), 0);
    return b + i;
  }

  /** Bookings ordered by their start date+time; undated ones sink to the end. */
  bookingsByDate(bookings: Booking[]): Booking[] {
    return [...bookings].sort((a, b) =>
      (a.checkIn?.toMillis() ?? Number.POSITIVE_INFINITY) - (b.checkIn?.toMillis() ?? Number.POSITIVE_INFINITY)
    );
  }

  /** True when a timestamp carries a meaningful time-of-day (not midnight). */
  hasTime(ts?: { toDate(): Date } | null): boolean {
    if (!ts) return false;
    const d = ts.toDate();
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  activeModeIcon(): string {
    return this.travelModes.find(m => m.value === this.travelMode())?.icon ?? 'directions_walk';
  }

  activeModeLabel(): string {
    return this.travelModes.find(m => m.value === this.travelMode())?.label ?? 'Walking';
  }
}
