import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ItineraryService } from '../../../../core/services/itinerary.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ItineraryItem, ItemCategory } from '../../../../core/models/itinerary-item.model';
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
    MatIconModule, MatProgressSpinnerModule,
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
    { value: 'accommodation', label: 'Accommodation', icon: 'hotel' },
    { value: 'activity', label: 'Activity', icon: 'local_activity' },
    { value: 'food', label: 'Food & Drink', icon: 'restaurant' },
    { value: 'other', label: 'Other', icon: 'more_horiz' },
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
  });

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
