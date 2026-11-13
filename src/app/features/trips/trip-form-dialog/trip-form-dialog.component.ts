import { Component, inject, signal, NgZone, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { TripService } from '../../../core/services/trip.service';
import { CoverPhotoService } from '../../../core/services/cover-photo.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { Trip, TripType, VehicleKind } from '../../../core/models/trip.model';
import { Timestamp } from '@angular/fire/firestore';
import { calendarDate, toCalendarTimestamp } from '../../../core/util/trip-date.util';
import { from, Observable, Subject } from 'rxjs';
import { map, debounceTime, distinctUntilChanged, filter, takeUntil } from 'rxjs/operators';

export interface TripFormDialogData {
  trip?: Trip;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'BRL', 'INR', 'CHF'];

export interface TripTypeMeta {
  value: TripType;
  label: string;
  icon: string;
  /** One-line why-it-matters shown on the selection card. */
  blurb: string;
  /** CSS class driving the little icon animation. */
  anim: string;
}

export const TRIP_TYPES: TripTypeMeta[] = [
  {
    value: 'road-trip', label: 'Road Trip', icon: 'directions_car', anim: 'anim-drive',
    blurb: 'Track your route start → end and whether it\'s your car or a rental. We\'ll suggest driving essentials, fuel/mileage costs, and skip flight-only items.',
  },
  {
    value: 'flight-domestic', label: 'Domestic Flight', icon: 'flight_takeoff', anim: 'anim-fly',
    blurb: 'Carry-on & liquid limits, boarding-pass/ID reminders. Flight times show in each airport\'s local zone.',
  },
  {
    value: 'flight-international', label: 'International Flight', icon: 'public', anim: 'anim-spin',
    blurb: 'Passport, visas, adapters & currency reminders, checked-bag rules, and airport-local departure/arrival times across zones.',
  },
  {
    value: 'train', label: 'Train / Rail', icon: 'train', anim: 'anim-slide',
    blurb: 'Rail-friendly packing and ticket/pass tracking — no baggage limits, station-to-station timing.',
  },
  {
    value: 'cruise', label: 'Cruise', icon: 'directions_boat', anim: 'anim-rock',
    blurb: 'Cabin details, formal-night attire, motion-sickness prep, and shore-excursion port days.',
  },
  {
    value: 'other', label: 'Something Else', icon: 'luggage', anim: 'anim-float',
    blurb: 'A flexible trip — we\'ll keep the essentials simple and let you add what you need.',
  },
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-trip-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, NgClass, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatDatepickerModule, MatNativeDateModule, MatSelectModule,
    MatButtonToggleModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatAutocompleteModule,
  ],
  templateUrl: './trip-form-dialog.component.html',
  styleUrl: './trip-form-dialog.component.scss',
})
export class TripFormDialogComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private tripService = inject(TripService);
  private coverPhotoService = inject(CoverPhotoService);
  private dialogRef = inject(MatDialogRef<TripFormDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private mapsLoader = inject(GoogleMapsLoaderService);
  private ngZone = inject(NgZone);
  data = inject<TripFormDialogData>(MAT_DIALOG_DATA);

  loading = signal(false);
  currencies = CURRENCIES;
  isEdit = !!this.data?.trip;

  /** Two-step flow: new trips pick a type first (step 1) then fill the form
   *  (step 2); edits jump straight to the form. */
  step = signal<1 | 2>(this.isEdit ? 2 : 1);

  placeSuggestions = signal<google.maps.places.AutocompletePrediction[]>([]);
  selectedPhotoUrl = signal<string | null>(this.data?.trip?.coverPhotoUrl ?? null);
  photoOptions = signal<string[]>([]);
  fetchingPhoto = signal(false);
  mapsReady = signal(false);

  private autocompleteService?: google.maps.places.AutocompleteService;
  private destinationInput$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  readonly tripTypes = TRIP_TYPES;

  form = this.fb.group({
    name: [this.data?.trip?.name ?? '', [Validators.required, Validators.maxLength(60)]],
    tripType: [this.data?.trip?.tripType ?? 'other' as TripType, [Validators.required]],
    destination: [this.data?.trip?.destination ?? '', [Validators.required]],
    description: [this.data?.trip?.description ?? ''],
    startDate: [this.data?.trip?.startDate ? calendarDate(this.data.trip.startDate) : null, Validators.required],
    endDate: [this.data?.trip?.endDate ? calendarDate(this.data.trip.endDate) : null, Validators.required],
    currency: [this.data?.trip?.currency ?? 'USD', Validators.required],
    // Road-trip-only fields.
    startLocation: [this.data?.trip?.startLocation ?? ''],
    endLocation: [this.data?.trip?.endLocation ?? ''],
    vehicle: [this.data?.trip?.vehicle ?? 'own' as VehicleKind],
  });

  /** Reactive flag for showing road-trip-only fields. */
  get isRoadTrip(): boolean {
    return this.form.get('tripType')?.value === 'road-trip';
  }

  /** Metadata for the currently-selected type (title, icon, blurb). */
  get selectedTypeMeta(): TripTypeMeta | undefined {
    return this.tripTypes.find(t => t.value === this.form.get('tripType')?.value);
  }

  @ViewChild('dialogBody', { read: ElementRef }) private dialogBody?: ElementRef<HTMLElement>;

  /** Reset the modal's scroll to the top after a step swaps, so the new step
   *  never starts mid-scroll (which looked like "broken" scrolling). */
  private resetScroll() {
    setTimeout(() => { if (this.dialogBody) this.dialogBody.nativeElement.scrollTop = 0; });
  }

  /** Pick a type card → advance to the form. */
  chooseType(value: TripType) {
    this.form.patchValue({ tripType: value });
    this.step.set(2);
    this.resetScroll();
  }

  /** Go back to the type picker (new trips only). */
  backToTypes() {
    this.step.set(1);
    this.resetScroll();
  }

  get startDateValue(): Date | null {
    return this.form.get('startDate')?.value ?? null;
  }

  ngOnInit() {
    this.mapsLoader.load().subscribe(loaded => {
      this.ngZone.run(() => {
        this.mapsReady.set(loaded);
        if (loaded) {
          this.autocompleteService = new google.maps.places.AutocompleteService();
        }
      });
    });

    this.destinationInput$.pipe(
      debounceTime(280),
      distinctUntilChanged(),
      filter(q => q.length >= 2 && this.mapsReady()),
      takeUntil(this.destroy$),
    ).subscribe(query => this.fetchSuggestions(query));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDestinationInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value.trim()) {
      this.placeSuggestions.set([]);
      return;
    }
    this.destinationInput$.next(value);
  }

  onPlaceSelected(event: MatAutocompleteSelectedEvent): void {
    const desc = event.option.value as string;
    const suggestion = this.placeSuggestions().find(s => s.description === desc);
    this.placeSuggestions.set([]);
    if (suggestion) {
      this.fetchPlacePhoto(suggestion.place_id);
    }
  }

  private fetchSuggestions(input: string): void {
    if (!this.autocompleteService) return;
    this.autocompleteService.getPlacePredictions(
      { input, types: ['geocode'] },
      (predictions, status) => {
        this.ngZone.run(() => {
          this.placeSuggestions.set(
            status === google.maps.places.PlacesServiceStatus.OK ? (predictions ?? []) : []
          );
        });
      }
    );
  }

  /** Re-fetch cover-photo options for the current destination (e.g. when
   *  editing a trip, without re-selecting from the autocomplete). */
  changePhoto(): void {
    const dest = this.form.get('destination')?.value?.trim();
    if (!dest || !this.mapsReady() || !this.autocompleteService) return;
    this.fetchingPhoto.set(true);
    this.autocompleteService.getPlacePredictions(
      { input: dest, types: ['geocode'] },
      (predictions, status) => {
        this.ngZone.run(() => {
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions?.[0]) {
            this.fetchPlacePhoto(predictions[0].place_id);
          } else {
            this.fetchingPhoto.set(false);
          }
        });
      }
    );
  }

  private fetchPlacePhoto(placeId: string): void {
    this.fetchingPhoto.set(true);
    const el = document.createElement('div');
    const svc = new google.maps.places.PlacesService(el);
    svc.getDetails(
      { placeId, fields: ['photos'] },
      (place: google.maps.places.PlaceResult | null, status: string) => {
        this.ngZone.run(() => {
          this.fetchingPhoto.set(false);
          if (status === 'OK' && place?.photos?.length) {
            const urls = place.photos.slice(0, 5).map(p => p.getUrl({ maxWidth: 1200, maxHeight: 800 }));
            this.photoOptions.set(urls);
            this.selectedPhotoUrl.set(urls[0]);
          }
        });
      }
    );
  }

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.snackBar.open('Please fill in all required fields.', 'OK', { duration: 3000 });
      return;
    }
    this.loading.set(true);
    try {
      const { name, tripType, destination, description, startDate, endDate, currency,
              startLocation, endLocation, vehicle } = this.form.value;

      // Persist the cover to Storage so the (otherwise short-lived) Google photo
      // URL doesn't expire. Falls back to whatever we have if persistence fails.
      let coverPhotoUrl = this.selectedPhotoUrl() ?? this.data?.trip?.coverPhotoUrl ?? '';
      if (coverPhotoUrl && !this.coverPhotoService.isPersisted(coverPhotoUrl)) {
        try {
          coverPhotoUrl = await this.coverPhotoService.persist(coverPhotoUrl);
        } catch {
          this.snackBar.open('Couldn\'t save a permanent copy of the cover photo — using a temporary one.', 'OK', { duration: 4000 });
        }
      }

      const isRoad = tripType === 'road-trip';
      const payload: Omit<Trip, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
        name: name!,
        tripType: (tripType ?? 'other') as TripType,
        destination: destination!,
        description: description ?? '',
        startDate: toCalendarTimestamp(startDate!),
        endDate: toCalendarTimestamp(endDate!),
        currency: currency!,
        coverPhotoUrl,
        // Road-trip-only fields (kept off other trip types).
        ...(isRoad ? {
          startLocation: startLocation?.trim() || undefined,
          endLocation: endLocation?.trim() || undefined,
          vehicle: (vehicle ?? 'own') as VehicleKind,
        } : {}),
      };

      const op: Observable<void> = this.isEdit
        ? from(this.tripService.updateTrip(this.data.trip!.id!, payload))
        : from(this.tripService.createTrip(payload)).pipe(map(() => undefined));

      op.subscribe({
        next: () => this.dialogRef.close(true),
        error: (err) => {
          this.loading.set(false);
          this.snackBar.open(err?.message ?? 'Failed to save trip.', 'Dismiss', { duration: 6000 });
        },
      });
    } catch (err: any) {
      this.loading.set(false);
      this.snackBar.open(err?.message ?? 'Unexpected error.', 'Dismiss', { duration: 6000 });
    }
  }
}
