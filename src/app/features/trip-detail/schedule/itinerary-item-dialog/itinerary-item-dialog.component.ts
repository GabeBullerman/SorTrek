import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ItineraryService } from '../../../../core/services/itinerary.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ItineraryItem, ItemCategory, DriveStop } from '../../../../core/models/itinerary-item.model';
import { Timestamp } from '@angular/fire/firestore';
import { calendarDate, toCalendarTimestamp } from '../../../../core/util/trip-date.util';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ItineraryItemDialogData {
  tripId: string;
  item?: ItineraryItem;
  defaultDate?: Date;
  existingCount: number;
  /** When true, the creator lacks direct edit rights — create as a proposal. */
  propose?: boolean;
}

@Component({
  selector: 'app-itinerary-item-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatDatepickerModule, MatNativeDateModule,
    MatIconModule, MatTooltipModule, MatProgressSpinnerModule,
  ],
  templateUrl: './itinerary-item-dialog.component.html',
  styleUrl: './itinerary-item-dialog.component.scss',
})
export class ItineraryItemDialogComponent {
  private fb = inject(FormBuilder);
  private itineraryService = inject(ItineraryService);
  private dialogRef = inject(MatDialogRef<ItineraryItemDialogComponent>);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  data = inject<ItineraryItemDialogData>(MAT_DIALOG_DATA);

  loading = signal(false);
  isEdit = !!this.data.item;

  categories: { value: ItemCategory; label: string; icon: string }[] = [
    { value: 'transport', label: 'Transport', icon: 'directions_car' },
    { value: 'drive', label: 'Drive (road-trip leg)', icon: 'route' },
    { value: 'accommodation', label: 'Accommodation', icon: 'hotel' },
    { value: 'activity', label: 'Activity', icon: 'local_activity' },
    { value: 'food', label: 'Food & Drink', icon: 'restaurant' },
    { value: 'other', label: 'Other', icon: 'more_horiz' },
  ];

  readonly stopKinds: { value: DriveStop['kind']; label: string; icon: string }[] = [
    { value: 'gas',    label: 'Gas / Charge', icon: 'local_gas_station' },
    { value: 'food',   label: 'Food',         icon: 'restaurant' },
    { value: 'sights', label: 'Sightseeing',  icon: 'photo_camera' },
    { value: 'rest',   label: 'Rest break',   icon: 'airline_seat_recline_normal' },
    { value: 'other',  label: 'Other',        icon: 'more_horiz' },
  ];

  form = this.fb.group({
    title: [this.data.item?.title ?? '', Validators.required],
    date: [this.data.item?.date ? calendarDate(this.data.item.date) : (this.data.defaultDate ?? null), Validators.required],
    startTime: [this.data.item?.startTime ?? ''],
    endTime: [this.data.item?.endTime ?? ''],
    category: [this.data.item?.category ?? 'activity' as ItemCategory, Validators.required],
    location: [this.data.item?.location ?? ''],
    cost: [this.data.item?.cost ?? null],
    currency: [this.data.item?.currency ?? 'USD'],
    costType: [this.data.item?.costType ?? 'total' as 'total' | 'per-person'],
    description: [this.data.item?.description ?? ''],
    notes: [this.data.item?.notes ?? ''],
    link: [this.data.item?.link ?? ''],
    fromLocation: [this.data.item?.fromLocation ?? ''],
    toLocation: [this.data.item?.toLocation ?? ''],
    stops: this.fb.array<FormGroup>(
      (this.data.item?.stops ?? []).map(s => this.stopGroup(s))
    ),
  });

  get stops(): FormArray<FormGroup> {
    return this.form.controls.stops as FormArray<FormGroup>;
  }

  private stopGroup(s?: DriveStop): FormGroup {
    return this.fb.group({
      name:  new FormControl(s?.name ?? '', { nonNullable: true }),
      kind:  new FormControl<DriveStop['kind']>(s?.kind ?? 'gas', { nonNullable: true }),
      time:  new FormControl(s?.time ?? '', { nonNullable: true }),
      notes: new FormControl(s?.notes ?? '', { nonNullable: true }),
    });
  }

  addStop() {
    this.stops.push(this.stopGroup());
  }

  removeStop(index: number) {
    this.stops.removeAt(index);
  }

  isDrive(): boolean {
    return this.form.value.category === 'drive';
  }

  /** Suggest a title for a drive once both endpoints are set (only if empty). */
  suggestDriveTitle() {
    const v = this.form.value;
    if (v.category === 'drive' && !v.title?.trim() && v.fromLocation?.trim() && v.toLocation?.trim()) {
      this.form.patchValue({ title: `Drive: ${v.fromLocation.trim()} → ${v.toLocation.trim()}` });
    }
  }

  submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    const v = this.form.value;
    const payload: Omit<ItineraryItem, 'id'> = {
      tripId: this.data.tripId,
      title: v.title!,
      date: toCalendarTimestamp(v.date!),
      startTime: v.startTime ?? undefined,
      endTime: v.endTime ?? undefined,
      category: v.category!,
      location: v.location ?? undefined,
      // Preserve any coordinates an item already had (set elsewhere); the form
      // no longer collects them.
      latitude: this.data.item?.latitude,
      longitude: this.data.item?.longitude,
      cost: v.cost ? Number(v.cost) : undefined,
      currency: v.currency ?? undefined,
      costType: v.cost ? (v.costType ?? 'total') : undefined,
      description: v.description ?? undefined,
      notes: v.notes ?? undefined,
      link: v.link?.trim() || undefined,
      fromLocation: v.category === 'drive' ? (v.fromLocation?.trim() || undefined) : undefined,
      toLocation: v.category === 'drive' ? (v.toLocation?.trim() || undefined) : undefined,
      stops: v.category === 'drive' ? cleanStops(this.stops.value) : undefined,
      order: this.data.item?.order ?? this.data.existingCount,
      // Editing existing items is unaffected; only new items can be proposals.
      ...(!this.isEdit && this.data.propose
        ? { proposed: true, proposedBy: this.auth.currentUser?.uid }
        : {}),
    };

    const op: Observable<void> = this.isEdit
      ? from(this.itineraryService.updateItem(this.data.item!.id!, payload))
      : from(this.itineraryService.createItem(payload)).pipe(map(() => undefined));

    op.subscribe({
      next: () => {
        if (!this.isEdit && this.data.propose) {
          this.snackBar.open('Proposed — sent to the trip owner for approval.', undefined, { duration: 3500 });
        }
        this.dialogRef.close(true);
      },
      error: () => this.loading.set(false),
    });
  }
}

/** Keep stops that have a name; drop empty optional fields (Firestore rejects
 *  `undefined`, even nested inside an array). */
function cleanStops(rows: { name?: string; kind?: string; time?: string; notes?: string }[]): DriveStop[] | undefined {
  const out = rows
    .map(r => {
      const stop: DriveStop = {
        name: (r.name ?? '').trim(),
        kind: (r.kind ?? 'other') as DriveStop['kind'],
      };
      if (r.time?.trim()) stop.time = r.time.trim();
      if (r.notes?.trim()) stop.notes = r.notes.trim();
      return stop;
    })
    .filter(s => s.name);
  return out.length ? out : undefined;
}
