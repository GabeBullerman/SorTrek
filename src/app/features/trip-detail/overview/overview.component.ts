import { Component, Input, OnInit, inject, signal, effect, untracked, viewChild } from '@angular/core';
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
import { IcsExportService } from '../../../core/services/ics-export.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { TimezoneService } from '../../../core/services/timezone.service';
import { WeatherService, WeatherDay } from '../../../core/services/weather.service';
import { CardReminderService } from '../../../core/services/card-reminder.service';
import { UserPreferencesService } from '../../../core/services/user-preferences.service';
import { calendarDate, localDayKey, utcDayKey, localDayNum, utcDayNum, daysUntilCalendar } from '../../../core/util/trip-date.util';
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
  private prefs = inject(UserPreferencesService);
  private icsExportService = inject(IcsExportService);
  private snackBar = inject(MatSnackBar);
  private tz = inject(TimezoneService);

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
  private mapRef = viewChild(GoogleMap);

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
      if (!this.geocodeAttempted && items.filter(i => i.latitude && i.longitude).length === 0
          && this.bookingPins().length === 0) {
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

    // Auto-fit the map to contain every pin (itinerary + bookings).
    // Reading these signals registers them as dependencies so the map
    // re-frames whenever the pins or selected day change.
    effect(() => {
      const map = this.mapRef();
      this.allItems();
      this.bookingPins();
      this.selectedDayIso();
      if (!map) return;
      untracked(() => this.fitMapToPins());
    });
  }

  /** Frame the map to all currently visible pins; falls back to a single
   *  centred pin, or leaves the destination center when there are none. */
  private fitMapToPins(): void {
    const gmap = this.mapRef()?.googleMap;
    if (!gmap) return;
    const positions = [
      ...this.getVisiblePins(this.allItems()).map(p => p.position),
      ...this.bookingPins().map(p => p.position),
    ];
    if (positions.length === 0) return;
    if (positions.length === 1) {
      gmap.setCenter(positions[0]);
      gmap.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    positions.forEach(p => bounds.extend(p));
    gmap.fitBounds(bounds, 48);
  }

  /** Fired when the Google map instance finishes initializing. With lazy-loaded
   *  (@defer) tabs the fit-effect can run before `.googleMap` exists and then
   *  never retries; this guarantees the initial fit-to-pins after the map is ready. */
  onMapReady(): void {
    this.fitMapToPins();
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
      this.prefs.remindersEnabled() &&
      this.cardReminderService.shouldRemind(this.trip) &&
      !this.cardReminderService.isDismissed(this.tripId)
    ) {
      this.showCardReminder.set(true);
    }
  }

  get daysUntilTrip(): number {
    return daysUntilCalendar(this.trip.startDate.toDate());
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
    // `date` is a real (weather forecast) local day; trip bounds are calendar
    // days stored at UTC midnight. Compare and count in calendar-day space.
    const t = localDayNum(date);
    const start = this.trip.startDate.toDate();
    const end   = this.trip.endDate.toDate();
    if (t < utcDayNum(start) || t > utcDayNum(end)) return null;
    const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((d - s) / 86_400_000) + 1;
  }

  get tripDays(): TripDay[] {
    const days: TripDay[] = [];
    // Local-midnight dates of the trip's calendar days (timezone-stable).
    const start = calendarDate(this.trip.startDate);
    const end = calendarDate(this.trip.endDate);
    const cur = new Date(start);
    let num = 1;
    while (cur <= end) {
      days.push({
        date: new Date(cur),
        iso: localDayKey(cur),
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
      // Activity dates are calendar days (UTC midnight) → match on UTC day key.
      .filter(i => i.date && utcDayKey(i.date.toDate()) === dayIso)
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

  // ── "Today" card ─────────────────────────────────────────────────
  /** True when today's local calendar day falls within [startDate, endDate]. */
  isOnTripNow(): boolean {
    const today = localDayNum(new Date());
    return today >= utcDayNum(this.trip.startDate.toDate())
        && today <= utcDayNum(this.trip.endDate.toDate());
  }

  /** Today's date as a Date at local midnight (for the card heading). */
  get todayDate(): Date {
    return new Date();
  }

  /** Itinerary items scheduled for today's local day, sorted by startTime
   *  (items without a time sink to the end). */
  todayItinerary(items: ItineraryItem[]): ItineraryItem[] {
    const todayKey = localDayKey(new Date());
    return items
      .filter(i => i.date && utcDayKey(i.date.toDate()) === todayKey)
      .sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  /** Material icon for an itinerary category. */
  categoryIcon(category: ItineraryItem['category']): string {
    switch (category) {
      case 'activity':      return 'local_activity';
      case 'accommodation': return 'hotel';
      case 'transport':     return 'directions_car';
      case 'food':          return 'restaurant';
      default:              return 'place';
    }
  }

  /** Material icon for a booking type. */
  bookingIcon(type: Booking['type']): string {
    switch (type) {
      case 'flight':      return 'flight';
      case 'hotel':       return 'hotel';
      case 'airbnb':      return 'home';
      case 'car-rental':  return 'directions_car';
      default:            return 'bookmark';
    }
  }

  /** The single soonest dated thing strictly after now: a booking check-in
   *  (flight departure) or a timed itinerary item. Null when nothing is left. */
  nextUp(bookings: Booking[], items: ItineraryItem[]): { label: string; icon: string; when: Date } | null {
    const now = new Date();
    const candidates: { label: string; icon: string; when: Date }[] = [];

    for (const b of bookings) {
      if (b.status === 'cancelled' || !b.checkIn) continue;
      const when = b.checkIn.toDate();
      if (when > now) {
        candidates.push({ label: b.title, icon: this.bookingIcon(b.type), when });
      }
    }

    for (const i of items) {
      // Local-midnight of the activity's calendar day, then apply its local time.
      const d = i.date ? calendarDate(i.date) : null;
      if (!d) continue;
      if (i.startTime) {
        const [h, m] = i.startTime.split(':').map(n => parseInt(n, 10));
        if (!isNaN(h)) d.setHours(h, isNaN(m) ? 0 : m, 0, 0);
      }
      if (d > now) {
        candidates.push({ label: i.title, icon: this.categoryIcon(i.category), when: d });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.when.getTime() - b.when.getTime());
    return candidates[0];
  }

  /** Bookings ordered by their start date+time; undated ones sink to the end. */
  bookingsByDate(bookings: Booking[]): Booking[] {
    return [...bookings].sort((a, b) =>
      (a.checkIn?.toMillis() ?? Number.POSITIVE_INFINITY) - (b.checkIn?.toMillis() ?? Number.POSITIVE_INFINITY)
    );
  }

  /** True when a flight's departure & arrival airports are in different time
   *  zones, so we should annotate each time with its airport's zone. */
  flightCrossesZones(b: Booking): boolean {
    return b.type === 'flight'
      && this.tz.crossesZones(
        b.departureAirport, b.arrivalAirport,
        b.checkIn?.toDate(), b.checkOut?.toDate(),
      );
  }

  /** Short zone label (e.g. "MST") for the departure airport — null unless the
   *  flight crosses zones. */
  depZoneLabel(b: Booking): string | null {
    return this.flightCrossesZones(b)
      ? this.tz.zoneLabel(b.departureAirport, b.checkIn?.toDate()) : null;
  }

  /** Short zone label (e.g. "CEST") for the arrival airport — null unless the
   *  flight crosses zones. */
  arrZoneLabel(b: Booking): string | null {
    return this.flightCrossesZones(b)
      ? this.tz.zoneLabel(b.arrivalAirport, b.checkOut?.toDate()) : null;
  }

  /** True when a timestamp carries a meaningful time-of-day (not midnight). */
  hasTime(ts?: { toDate(): Date } | null): boolean {
    if (!ts) return false;
    const d = ts.toDate();
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  /** Build a .ics calendar from the trip's bookings + itinerary and download it. */
  exportToCalendar(): void {
    const bookings = this.allBookings();
    const items = this.allItems();
    const ics = this.icsExportService.buildIcs(this.trip, bookings, items);
    if (!ics) {
      this.snackBar.open('Nothing to add to calendar yet', undefined, { duration: 2500 });
      return;
    }
    const name = (this.trip?.name || 'trip').trim();
    this.icsExportService.download(`${name}.ics`, ics);
  }

  activeModeIcon(): string {
    return this.travelModes.find(m => m.value === this.travelMode())?.icon ?? 'directions_walk';
  }

  activeModeLabel(): string {
    return this.travelModes.find(m => m.value === this.travelMode())?.label ?? 'Walking';
  }
}
