import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
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
}

interface PublicBooking {
  type?: string;
  title: string;
  checkIn?: string;
  checkOut?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  flightNumber?: string;
}

interface PublicItineraryResponse {
  trip?: PublicTrip;
  itinerary?: PublicItineraryItem[];
  bookings?: PublicBooking[];
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

  readonly state = signal<'loading' | 'error' | 'loaded'>('loading');
  readonly trip = signal<PublicTrip | null>(null);
  readonly bookings = signal<PublicBooking[]>([]);

  readonly days = signal<DayGroup[]>([]);
  readonly hasBookings = computed(() => this.bookings().length > 0);

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
        this.bookings.set(res.bookings ?? []);
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

  bookingIcon(type?: string): string {
    const t = (type ?? '').toLowerCase();
    if (t.includes('flight')) return 'flight';
    if (t.includes('stay') || t.includes('hotel') || t.includes('accommodation') || t.includes('lodging')) return 'hotel';
    if (t.includes('car') || t.includes('rental')) return 'directions_car';
    if (t.includes('train')) return 'train';
    return 'confirmation_number';
  }
}
