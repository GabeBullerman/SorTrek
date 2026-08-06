import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

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

  readonly state = signal<'loading' | 'error' | 'loaded'>('loading');
  readonly trip = signal<PublicTrip | null>(null);
  readonly stays = signal<PublicStay[]>([]);
  readonly mapArea = signal<string>('');

  readonly days = signal<DayGroup[]>([]);
  readonly hasStays = computed(() => this.stays().length > 0);

  /**
   * Google Maps embed for the general stay area. Uses the keyless `?output=embed`
   * form so no API key is exposed on this public page; the URL is trusted only
   * after we build it from an encoded, server-provided place string.
   */
  readonly mapUrl = computed<SafeResourceUrl | null>(() => {
    const q = this.mapArea().trim();
    if (!q) return null;
    const url = `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=11&output=embed`;
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
        this.mapArea.set(res.mapArea ?? res.trip.destination ?? '');
        this.days.set(this.groupByDate(res.itinerary ?? []));
        this.state.set('loaded');
      },
      error: () => this.state.set('error'),
    });
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
