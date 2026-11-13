import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ParticipantService } from '../../../../core/services/participant.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { TripParticipant } from '../../../../core/models/trip-participant.model';
import { Expense, ExpenseCategory } from '../../../../core/models/expense.model';
import { Timestamp } from '@angular/fire/firestore';
import { debounceTime, switchMap, take, of } from 'rxjs';

export interface ExpenseDialogData {
  tripId: string;
  tripCurrency: string;
  expense?: Expense;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-expense-dialog',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule,
    MatCheckboxModule, MatDatepickerModule, MatNativeDateModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './expense-dialog.component.html',
  styleUrl: './expense-dialog.component.scss',
})
export class ExpenseDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private participantService = inject(ParticipantService);
  private currencyService = inject(CurrencyService);
  private dialogRef = inject(MatDialogRef<ExpenseDialogComponent>);
  readonly data: ExpenseDialogData = inject(MAT_DIALOG_DATA);

  participants = signal<TripParticipant[]>([]);
  saving = signal(false);

  /** Live preview of the amount converted to the trip currency (null when same currency or unavailable). */
  convertedPreview = signal<number | null>(null);
  loadingPreview = signal(false);

  readonly categories: { value: ExpenseCategory; label: string; icon: string }[] = [
    { value: 'food',          label: 'Food & Drink',      icon: 'restaurant' },
    { value: 'transport',     label: 'Transport',          icon: 'directions_car' },
    { value: 'activity',      label: 'Activity',           icon: 'local_activity' },
    { value: 'accommodation', label: 'Accommodation',      icon: 'hotel' },
    { value: 'shopping',      label: 'Shopping',           icon: 'shopping_bag' },
    { value: 'other',         label: 'Other',              icon: 'more_horiz' },
  ];

  readonly commonCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'CHF'];

  form = this.fb.group({
    title:          [this.data.expense?.title ?? '',       [Validators.required]],
    amount:         [this.data.expense?.amount ?? null,    [Validators.required, Validators.min(0.01)]],
    currency:       [this.data.expense?.currency ?? this.data.tripCurrency, [Validators.required]],
    category:       [this.data.expense?.category ?? 'other' as ExpenseCategory, [Validators.required]],
    paidById:       [this.data.expense?.paidById ?? null as string | null],
    participantIds: [this.data.expense?.participantIds ?? [] as string[]],
    date:           [this.data.expense?.date ? this.data.expense.date.toDate() : null as Date | null],
    notes:          [this.data.expense?.notes ?? ''],
    pointsUsed:     [this.data.expense?.pointsUsed ?? null as number | null],
    pointsProgram:  [this.data.expense?.pointsProgram ?? ''],
  });

  ngOnInit() {
    this.participantService.getParticipants(this.data.tripId).subscribe(p => {
      this.participants.set(p);
    });

    // Live converted preview when amount or currency changes.
    this.form.valueChanges.pipe(
      debounceTime(300),
      switchMap(() => {
        const amount = Number(this.form.get('amount')!.value);
        const currency = this.form.get('currency')!.value as string;
        if (!amount || !currency || currency === this.data.tripCurrency) {
          this.loadingPreview.set(false);
          this.convertedPreview.set(null);
          return of(null);
        }
        this.loadingPreview.set(true);
        return this.currencyService.getRate(currency, this.data.tripCurrency).pipe(
          take(1),
        );
      }),
    ).subscribe(rate => {
      this.loadingPreview.set(false);
      if (rate) {
        const amount = Number(this.form.get('amount')!.value);
        this.convertedPreview.set(this.round2(amount * rate.rate));
      } else {
        this.convertedPreview.set(null);
      }
    });
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  submit() {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    const base: Omit<Expense, 'id' | 'createdAt'> = {
      tripId:         this.data.tripId,
      title:          v.title!,
      amount:         v.amount!,
      currency:       v.currency!,
      category:       v.category! as ExpenseCategory,
      paidById:       v.paidById ?? null,
      participantIds: v.participantIds?.length ? v.participantIds : undefined,
      notes:          v.notes ?? undefined,
      date:           v.date ? Timestamp.fromDate(v.date) : undefined,
      pointsUsed:     v.pointsUsed ? Number(v.pointsUsed) : undefined,
      pointsProgram:  v.pointsProgram?.trim() || undefined,
    };

    // Same currency — no conversion needed.
    if (base.currency === this.data.tripCurrency) {
      this.dialogRef.close({
        ...base,
        amountInTripCurrency: base.amount,
        conversionRate: 1,
      });
      return;
    }

    // Foreign currency — fetch the live rate, then close.
    this.currencyService.getRate(base.currency, this.data.tripCurrency).pipe(take(1)).subscribe(rate => {
      if (rate) {
        this.dialogRef.close({
          ...base,
          amountInTripCurrency: this.round2(base.amount * rate.rate),
          conversionRate: rate.rate,
        });
      } else {
        // Degrade gracefully: store native amount as the trip-currency figure, no rate.
        this.dialogRef.close({
          ...base,
          amountInTripCurrency: base.amount,
        });
      }
    });
  }

  clearParticipants() {
    this.form.get('participantIds')!.setValue([]);
  }

  selectAllParticipants() {
    this.form.get('participantIds')!.setValue(this.participants().map(p => p.id!));
  }

  cancel() {
    this.dialogRef.close();
  }
}
