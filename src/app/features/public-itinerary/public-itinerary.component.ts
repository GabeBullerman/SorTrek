import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GoogleMapsLoaderService } from '../../core/services/google-maps-loader.service';

interface PublicTrip {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverPhotoUrl?: string;
}

interface PublicItineraryItem {
  date: string;
  startTime?: string;
  endTime?: string;
  title: string;
  description?: string;
  location?: string;
  category?: string;
  proposed?: boolean;
}

interface PublicStay {
  type?: string;
  title: string;
  area?: string;
  checkIn?: string;
  checkOut?: string;
}

interface PublicItineraryResponse {
  trip?: PublicTrip;
  itinerary?: PublicItineraryItem[];
  stays?: PublicStay[];
  mapPlaces?: string[];
  mapArea?: string;
  error?: string;
  configured?: boolean;
}

interface DayGroup {
  date: string;
  items: PublicItineraryItem[];
}

const CATEGORY_ICONS: Record<string, string> = {
  transport: 'directions_transit',
  drive: 'route',
  accommodation: 'hotel',
  activity: 'local_activity',
  food: 'restaurant',
  other: 'place',
};

@Component({
  selector: 'app-public-itinerary',
  standalone: true,
  imports: [DatePipe, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './public-itinerary.component.html',
  styleUrl: './public-itinerary.component.scss',
})
export class PublicItineraryComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private mapsLoader = inject(GoogleMapsLoaderService);

  readonly state = signal<'loading' | 'error' | 'loaded'>('loading');
  readonly trip = signal<PublicTrip | null>(null);
  readonly stays = signal<PublicStay[]>([]);
  readonly mapPlaces = signal<string[]>([]);
  readonly mapArea = signal<string>('');
  /** 'js' = interactive multi-pin map; 'embed' = keyless single-area fallback. */
  readonly mapMode = signal<'js' | 'embed' | 'hidden'>('hidden');

  readonly days = signal<DayGroup[]>([]);
  readonly hasStays = computed(() => this.stays().length > 0);

  private mapInitStarted = false;

  /** Grabs the map container the moment it enters the DOM, then builds the map. */
  @ViewChild('mapEl') set mapElRef(el: ElementRef<HTMLDivElement> | undefined) {
    if (el && this.mapMode() === 'js' && !this.mapInitStarted) {
      this.mapInitStarted = true;
      this.initJsMap(el.nativeElement);
    }
  }

  /**
   * Keyless Google Maps embed for the general area — the FALLBACK used only if
   * Maps JS can't load. `?output=embed` needs no API key; the URL is trusted
   * only after we build it from an encoded, server-provided place string.
   */
  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const q = this.mapArea().trim();
    if (!q) return null;
    const url = `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=6&output=embed`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!token) {
      this.state.set('error');
      return;
    }

    this.http.get<PublicItineraryResponse>(`/api/public-itinerary?token=${encodeURIComponent(token)}`).subscribe({
      next: (res) => {
        if (!res || res.error || res.configured === false || !res.trip) {
          this.state.set('error');
          return;
        }
        this.trip.set(res.trip);
        this.stays.set(res.stays ?? []);
        this.mapPlaces.set(res.mapPlaces ?? []);
        this.mapArea.set(res.mapArea ?? res.trip.destination ?? '');
        this.days.set(this.groupByDate(res.itinerary ?? []));
        // Try the interactive multi-pin map when we have places; otherwise the
        // single-area embed; hide the map only when there's nothing to show.
        this.mapMode.set(
          this.mapPlaces().length ? 'js' : (this.mapArea() ? 'embed' : 'hidden')
        );
        this.state.set('loaded');
      },
      error: () => this.state.set('error'),
    });
  }

  /**
   * Build an interactive map with one geocoded pin per distinct area, zoomed to
   * fit them all. Falls back to the keyless single-area embed if Maps JS won't
   * load or nothing geocodes.
   */
  private initJsMap(container: HTMLElement) {
    this.mapsLoader.load().subscribe(ok => {
      const g = (window as any).google;
      if (!ok || !g?.maps) { this.mapMode.set('embed'); return; }

      const map = new g.maps.Map(container, {
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoom: 5,
        center: { lat: 20, lng: 0 },
      });
      const geocoder = new g.maps.Geocoder();
      const bounds = new g.maps.LatLngBounds();
      const dest = this.trip()?.destination ?? '';
      const places = this.mapPlaces();
      let pending = places.length;
      let placed = 0;

      places.forEach(place => {
        // Bias ambiguous single-word places toward the trip's country/region.
        const query = place.includes(',') || !dest ? place : `${place}, ${dest}`;
        geocoder.geocode({ address: query }, (results: any[], status: string) => {
          pending--;
          if (status === 'OK' && results?.[0]) {
            const loc = results[0].geometry.location;
            new g.maps.Marker({ map, position: loc, title: place });
            bounds.extend(loc);
            placed++;
          }
          if (pending === 0) this.finishMap(map, bounds, placed);
        });
      });
    });
  }

  private finishMap(map: any, bounds: any, placed: number) {
    if (placed === 0) {
      // Nothing geocoded — drop back to the keyless embed.
      this.mapMode.set('embed');
    } else if (placed === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(11);
    } else {
      map.fitBounds(bounds, 48);
    }
  }

  private groupByDate(items: PublicItineraryItem[]): DayGroup[] {
    const map = new Map<string, PublicItineraryItem[]>();
    for (const item of items) {
      const key = (item.date || '').slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, dayItems]) => ({
        date,
        items: dayItems.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')),
      }));
  }

  categoryIcon(category?: string): string {
    return CATEGORY_ICONS[(category ?? 'other').toLowerCase()] ?? 'place';
  }

  categoryClass(category?: string): string {
    return `category-${(category ?? 'other').toLowerCase()}`;
  }

  stayIcon(type?: string): string {
    const t = (type ?? '').toLowerCase();
    if (t.includes('airbnb') || t.includes('rental') || t.includes('home')) return 'home';
    return 'hotel';
  }
}
