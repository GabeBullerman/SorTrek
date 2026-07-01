import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AsyncPipe, DatePipe, CurrencyPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { TripService } from '../../core/services/trip.service';
import { Trip } from '../../core/models/trip.model';
import { localDayNum, utcDayNum } from '../../core/util/trip-date.util';

@Component({
  selector: 'app-past-trips',
  standalone: true,
  imports: [AsyncPipe, DatePipe, CurrencyPipe, MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './past-trips.component.html',
  styleUrl: './past-trips.component.scss',
})
export class PastTripsComponent {
  private tripService = inject(TripService);
  private router = inject(Router);

  readonly pastTrips$ = this.tripService.getTrips().pipe(
    // Past = the trip's end calendar day is before today (compare days, not instants).
    map(trips => trips.filter(t => utcDayNum(t.endDate.toDate()) < localDayNum(new Date()))),
    catchError(() => of([] as Trip[]))
  );

  openTrip(id: string) {
    this.router.navigate(['/trips', id]);
  }

  tripDuration(trip: Trip): number {
    const ms = trip.endDate.toDate().getTime() - trip.startDate.toDate().getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1;
  }
}
