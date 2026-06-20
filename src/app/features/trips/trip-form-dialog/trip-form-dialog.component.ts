import { Component, inject, signal, NgZone, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { TripService } from '../../../core/services/trip.service';
import { CoverPhotoService } from '../../../core/services/cover-photo.service';
import { GoogleMapsLoaderService } from '../../../core/services/google-maps-loader.service';
import { Trip } from '../../../core/models/trip.model';
import { Timestamp } from '@angular/fire/firestore';
import { from, Observable, Subject } from 'rxjs';
import { map, debounceTime, distinctUntilChanged, filter, takeUntil } from 'rxjs/operators';

export interface TripFormDialogData {
  trip?: Trip;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'BRL', 'INR', 'CHF'];

@Component({
  selector: 'app-trip-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatDatepickerModule, MatNativeDateModule, MatSelectModule,
    MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, MatAutocompleteModule,
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

  placeSuggestions = signal<google.maps.places.AutocompletePrediction[]>([]);
  selectedPhotoUrl = signal<string | null>(this.data?.trip?.coverPhotoUrl ?? null);
  photoOptions = signal<string[]>([]);
  fetchingPhoto = signal(false);
  mapsReady = signal(false);

  private autocompleteService?: google.maps.places.AutocompleteService;
  private destinationInput$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  form = this.fb.group({
    name: [this.data?.trip?.name ?? '', [Validators.required, Validators.maxLength(60)]],
    destination: [this.data?.trip?.destination ?? '', [Validators.required]],
    description: [this.data?.trip?.description ?? ''],
    startDate: [this.data?.trip?.startDate?.toDate() ?? null, Validators.required],
    endDate: [this.data?.trip?.endDate?.toDate() ?? null, Validators.required],
    currency: [this.data?.trip?.currency ?? 'USD', Validators.required],
  });

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
      const { name, destination, description, startDate, endDate, currency } = this.form.value;

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

      const payload: Omit<Trip, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
        name: name!,
        destination: destination!,
        description: description ?? '',
        startDate: Timestamp.fromDate(startDate!),
        endDate: Timestamp.fromDate(endDate!),
        currency: currency!,
        coverPhotoUrl,
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
