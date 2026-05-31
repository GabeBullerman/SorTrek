import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Timestamp } from '@angular/fire/firestore';
import { from } from 'rxjs';
import { Trip } from '../../../../core/models/trip.model';
import { BookingService } from '../../../../core/services/booking.service';
import { ExpenseService } from '../../../../core/services/expense.service';
import { EmailScraperService, ScannedBooking } from '../../../../core/services/email-scraper.service';
import { BookingType } from '../../../../core/models/booking.model';
import { ExpenseCategory } from '../../../../core/models/expense.model';

type ScanState = 'idle' | 'connecting' | 'scanning' | 'results' | 'empty' | 'error';

function toBookingType(t: string): BookingType {
  if (['flight', 'hotel', 'airbnb', 'car-rental'].includes(t)) return t as BookingType;
  return 'other';
}

function toExpenseCategory(type: string): ExpenseCategory {
  if (type === 'flight' || type === 'car-rental') return 'transport';
  if (type === 'hotel' || type === 'airbnb')      return 'accommodation';
  if (type === 'restaurant')                       return 'food';
  return 'other';
}

function parseDate(iso: string | undefined): Timestamp | undefined {
  if (!iso) return undefined;
  try { return Timestamp.fromDate(new Date(iso)); } catch { return undefined; }
}

@Component({
  selector: 'app-email-scan-dialog',
  standalone: true,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatCheckboxModule, MatChipsModule,
    CurrencyPipe, DatePipe,
  ],
  templateUrl: './email-scan-dialog.component.html',
  styleUrl: './email-scan-dialog.component.scss',
})
export class EmailScanDialogComponent {
  private data       = inject<{ trip: Trip; tripId: string }>(MAT_DIALOG_DATA);
  private emailScraper = inject(EmailScraperService);
  private bookingService = inject(BookingService);
  private expenseService = inject(ExpenseService);
  private snackBar = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<EmailScanDialogComponent>);

  readonly trip    = this.data.trip;
  readonly tripId  = this.data.tripId;

  state    = signal<ScanState>('idle');
  bookings = signal<ScannedBooking[]>([]);
  errorMsg = signal('');
  saving   = signal(false);

  readonly typeIcons: Record<string, string> = {
    flight:     'flight',
    hotel:      'hotel',
    airbnb:     'home',
    'car-rental': 'directions_car',
    restaurant: 'restaurant',
    other:      'bookmark',
  };

  readonly typeLabels: Record<string, string> = {
    flight:     'Flight',
    hotel:      'Hotel',
    airbnb:     'Airbnb / Rental',
    'car-rental': 'Car Rental',
    restaurant: 'Restaurant',
    other:      'Other',
  };

  get selectedCount(): number {
    return this.bookings().filter(b => b.selected).length;
  }

  startScan() {
    this.state.set('connecting');

    this.emailScraper.getGmailToken().subscribe(token => {
      if (!token) {
        this.state.set('error');
        this.errorMsg.set('Gmail permission was denied or the popup was closed. Please try again.');
        return;
      }

      this.state.set('scanning');

      this.emailScraper.scanEmails(token, this.trip).subscribe(results => {
        if (results.length === 0) {
          this.state.set('empty');
        } else {
          this.bookings.set(results);
          this.state.set('results');
        }
      });
    });
  }

  toggle(index: number) {
    this.bookings.update(list =>
      list.map((b, i) => i === index ? { ...b, selected: !b.selected } : b)
    );
  }

  selectAll() {
    this.bookings.update(list => list.map(b => ({ ...b, selected: true })));
  }

  deselectAll() {
    this.bookings.update(list => list.map(b => ({ ...b, selected: false })));
  }

  saveSelected() {
    const selected = this.bookings().filter(b => b.selected);
    if (!selected.length) return;

    this.saving.set(true);

    selected.forEach(b => {
      // Save booking
      from(this.bookingService.createBooking({
        tripId: this.tripId,
        type: toBookingType(b.type),
        title: b.title,
        provider: b.provider,
        confirmationNumber: b.confirmationNumber,
        checkIn: parseDate(b.checkIn),
        checkOut: parseDate(b.checkOut),
        cost: b.cost,
        currency: b.currency ?? this.trip.currency,
        status: 'confirmed',
      })).subscribe();

      // Also create expense if cost is known
      if (b.cost) {
        from(this.expenseService.createExpense({
          tripId: this.tripId,
          title: b.title,
          amount: b.cost,
          currency: b.currency ?? this.trip.currency,
          category: toExpenseCategory(b.type),
          date: parseDate(b.checkIn),
          notes: b.confirmationNumber ? `Confirmation: ${b.confirmationNumber}` : undefined,
        })).subscribe();
      }
    });

    this.snackBar.open(
      `Added ${selected.length} booking${selected.length > 1 ? 's' : ''} to your trip`,
      undefined,
      { duration: 3000 }
    );
    this.dialogRef.close(true);
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
  }
}
