import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DecimalPipe, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, combineLatest, map, catchError, of, from } from 'rxjs';
import { MoneyComponent } from '../../../shared/components/money/money.component';
import { BookingService } from '../../../core/services/booking.service';
import { ItineraryService } from '../../../core/services/itinerary.service';
import { ExpenseService } from '../../../core/services/expense.service';
import { UserService } from '../../../core/services/user.service';
import { CurrencyService, RateResult } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { ParticipantService } from '../../../core/services/participant.service';
import { Trip } from '../../../core/models/trip.model';
import { Booking } from '../../../core/models/booking.model';
import { ItineraryItem } from '../../../core/models/itinerary-item.model';
import { TripParticipant } from '../../../core/models/trip-participant.model';
import { Expense } from '../../../core/models/expense.model';
import {
  ExpenseDialogComponent,
  ExpenseDialogData,
} from './expense-dialog/expense-dialog.component';

interface CostBreakdown {
  category: string;
  label: string;
  icon: string;
  amount: number;
  color: string;
  items: { name: string; cost: number; currency: string }[];
}

interface PersonShare {
  participant: TripParticipant;
  totalShare: number;
  paidSelf: number;
  owesOrganizer: number;
}

interface CostsData {
  total: number;
  breakdown: CostBreakdown[];
  personShares: PersonShare[];
  participantCount: number;
  expenses: Expense[];
  participants: TripParticipant[];
}

export const FOREIGN_TX_FEE = 0.025;

@Component({
  selector: 'app-costs',
  standalone: true,
  imports: [
    AsyncPipe, CurrencyPipe, DecimalPipe, DatePipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatDividerModule, MatTooltipModule,
    MoneyComponent,
  ],
  templateUrl: './costs.component.html',
  styleUrl: './costs.component.scss',
})
export class CostsComponent implements OnInit {
  @Input() tripId!: string;
  @Input() trip!: Trip;

  private bookingService = inject(BookingService);
  private itineraryService = inject(ItineraryService);
  private expenseService = inject(ExpenseService);
  private participantService = inject(ParticipantService);
  private userService = inject(UserService);
  private currencyService = inject(CurrencyService);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  costs$!: Observable<CostsData>;
  homeCurrency = signal<string | null>(null);
  rateResult = signal<RateResult | null>(null);
  loadingRate = signal(false);
  showConverted = signal(false);
  readonly feeRate = FOREIGN_TX_FEE;

  readonly categoryMeta: Record<string, { label: string; icon: string; color: string }> = {
    food:          { label: 'Food & Drink',   icon: 'restaurant',     color: '#e65100' },
    transport:     { label: 'Local Transport', icon: 'directions_car', color: '#0277bd' },
    activity:      { label: 'Activities',      icon: 'local_activity', color: '#2e7d32' },
    accommodation: { label: 'Accommodation',   icon: 'hotel',          color: '#6a1b9a' },
    shopping:      { label: 'Shopping',        icon: 'shopping_bag',   color: '#ad1457' },
    other:         { label: 'Other',           icon: 'more_horiz',     color: '#455a64' },
  };

  ngOnInit() {
    this.costs$ = combineLatest([
      this.bookingService.getBookings(this.tripId),
      this.itineraryService.getItems(this.tripId),
      this.participantService.getParticipants(this.tripId),
      this.expenseService.getExpenses(this.tripId),
    ]).pipe(
      map(([bookings, items, participants, expenses]) =>
        this.buildData(bookings, items, participants, expenses)
      ),
      catchError(() => of(this.buildData([], [], [], [])))
    );

    const uid = this.auth.currentUser?.uid;
    if (uid) {
      this.userService.getProfile(uid).subscribe(profile => {
        if (profile?.homeCurrency) {
          this.homeCurrency.set(profile.homeCurrency);
        }
      });
    }
  }

  openAddExpense() {
    const dialogData: ExpenseDialogData = {
      tripId: this.tripId,
      tripCurrency: this.trip.currency,
    };
    this.dialog.open(ExpenseDialogComponent, { data: dialogData, width: '520px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        from(this.expenseService.createExpense(result)).subscribe(() =>
          this.snackBar.open('Expense added', undefined, { duration: 2000 })
        );
      });
  }

  openEditExpense(expense: Expense) {
    const dialogData: ExpenseDialogData = {
      tripId: this.tripId,
      tripCurrency: this.trip.currency,
      expense,
    };
    this.dialog.open(ExpenseDialogComponent, { data: dialogData, width: '520px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        from(this.expenseService.updateExpense(expense.id!, result)).subscribe(() =>
          this.snackBar.open('Expense updated', undefined, { duration: 2000 })
        );
      });
  }

  deleteExpense(expense: Expense) {
    from(this.expenseService.deleteExpense(expense.id!)).subscribe(() =>
      this.snackBar.open('Expense removed', undefined, { duration: 2000 })
    );
  }

  participantName(id: string | null | undefined, participants: TripParticipant[]): string {
    if (!id) return 'Unknown';
    return participants.find(p => p.id === id)?.name ?? 'Unknown';
  }

  toggleConversion() {
    if (this.showConverted()) {
      this.showConverted.set(false);
      return;
    }
    const home = this.homeCurrency();
    const tripCurrency = this.trip.currency;
    if (!home || home === tripCurrency) {
      this.showConverted.set(true);
      return;
    }
    this.loadingRate.set(true);
    this.currencyService.getRate(tripCurrency, home).subscribe(result => {
      this.rateResult.set(result);
      this.loadingRate.set(false);
      this.showConverted.set(true);
    });
  }

  convert(amount: number): number {
    const r = this.rateResult();
    return r ? amount * r.rate : amount;
  }

  convertWithFee(amount: number): number {
    const base = this.convert(amount);
    return base * (1 + this.feeRate);
  }

  private buildData(
    bookings: Booking[],
    items: ItineraryItem[],
    participants: TripParticipant[],
    expenses: Expense[]
  ): CostsData {
    const breakdown = this.buildBreakdown(bookings, items, expenses);
    const total = breakdown.reduce((s, b) => s + b.amount, 0);
    const personShares = this.buildPersonShares(bookings, items, participants, expenses);

    return {
      total,
      breakdown: breakdown.filter(b => b.amount > 0 || b.items.length > 0),
      personShares,
      participantCount: participants.length,
      expenses,
      participants,
    };
  }

  private buildBreakdown(
    bookings: Booking[],
    items: ItineraryItem[],
    expenses: Expense[]
  ): CostBreakdown[] {
    const bd: CostBreakdown[] = [
      {
        category: 'flights', label: 'Flights', icon: 'flight', color: '#1565c0', amount: 0,
        items: bookings.filter(b => b.type === 'flight' && b.cost)
          .map(b => ({ name: b.title, cost: b.cost!, currency: b.currency ?? this.trip.currency })),
      },
      {
        category: 'accommodation', label: 'Accommodation', icon: 'hotel', color: '#6a1b9a', amount: 0,
        items: [
          ...bookings.filter(b => (b.type === 'hotel' || b.type === 'airbnb') && b.cost)
            .map(b => ({ name: b.title, cost: b.cost!, currency: b.currency ?? this.trip.currency })),
          ...expenses.filter(e => e.category === 'accommodation')
            .map(e => ({ name: e.title, cost: e.amount, currency: e.currency })),
        ],
      },
      {
        category: 'transport', label: 'Local Transport', icon: 'directions_car', color: '#0277bd', amount: 0,
        items: [
          ...bookings.filter(b => b.type === 'car-rental' && b.cost)
            .map(b => ({ name: b.title, cost: b.cost!, currency: b.currency ?? this.trip.currency })),
          ...items.filter(i => i.category === 'transport' && i.cost)
            .map(i => ({ name: i.title, cost: i.cost!, currency: i.currency ?? this.trip.currency })),
          ...expenses.filter(e => e.category === 'transport')
            .map(e => ({ name: e.title, cost: e.amount, currency: e.currency })),
        ],
      },
      {
        category: 'activities', label: 'Activities', icon: 'local_activity', color: '#2e7d32', amount: 0,
        items: [
          ...items.filter(i => i.category === 'activity' && i.cost)
            .map(i => ({ name: i.title, cost: i.cost!, currency: i.currency ?? this.trip.currency })),
          ...expenses.filter(e => e.category === 'activity')
            .map(e => ({ name: e.title, cost: e.amount, currency: e.currency })),
        ],
      },
      {
        category: 'food', label: 'Food & Drink', icon: 'restaurant', color: '#e65100', amount: 0,
        items: [
          ...items.filter(i => i.category === 'food' && i.cost)
            .map(i => ({ name: i.title, cost: i.cost!, currency: i.currency ?? this.trip.currency })),
          ...expenses.filter(e => e.category === 'food')
            .map(e => ({ name: e.title, cost: e.amount, currency: e.currency })),
        ],
      },
      {
        category: 'shopping', label: 'Shopping', icon: 'shopping_bag', color: '#ad1457', amount: 0,
        items: expenses.filter(e => e.category === 'shopping')
          .map(e => ({ name: e.title, cost: e.amount, currency: e.currency })),
      },
      {
        category: 'other', label: 'Other', icon: 'more_horiz', color: '#455a64', amount: 0,
        items: [
          ...bookings.filter(b => b.type === 'other' && b.cost)
            .map(b => ({ name: b.title, cost: b.cost!, currency: b.currency ?? this.trip.currency })),
          ...items.filter(i => i.category === 'other' && i.cost)
            .map(i => ({ name: i.title, cost: i.cost!, currency: i.currency ?? this.trip.currency })),
          ...expenses.filter(e => e.category === 'other')
            .map(e => ({ name: e.title, cost: e.amount, currency: e.currency })),
        ],
      },
    ];

    bd.forEach(b => {
      b.amount = b.items.reduce((s, i) => s + i.cost, 0);
    });

    return bd;
  }

  private buildPersonShares(
    bookings: Booking[],
    items: ItineraryItem[],
    participants: TripParticipant[],
    expenses: Expense[]
  ): PersonShare[] {
    if (participants.length === 0) return [];

    const shares = new Map<string, { share: number; paidSelf: number }>();
    participants.forEach(p => shares.set(p.id!, { share: 0, paidSelf: 0 }));

    for (const booking of bookings) {
      if (!booking.cost) continue;
      const applicable = booking.passengerIds?.length
        ? booking.passengerIds.filter(id => shares.has(id))
        : participants.map(p => p.id!);
      if (applicable.length === 0) continue;
      const perPerson = booking.cost / applicable.length;
      for (const id of applicable) {
        const s = shares.get(id);
        if (s) {
          s.share += perPerson;
          if (booking.paidById === id) s.paidSelf += perPerson;
        }
      }
    }

    for (const item of items) {
      if (!item.cost) continue;
      const perPerson = item.cost / participants.length;
      for (const p of participants) {
        const s = shares.get(p.id!);
        if (s) s.share += perPerson;
      }
    }

    for (const expense of expenses) {
      if (!expense.amount) continue;
      const applicable = expense.participantIds?.length
        ? expense.participantIds.filter(id => shares.has(id))
        : participants.map(p => p.id!);
      if (applicable.length === 0) continue;
      const perPerson = expense.amount / applicable.length;
      for (const id of applicable) {
        const s = shares.get(id);
        if (s) {
          s.share += perPerson;
          if (expense.paidById === id) s.paidSelf += perPerson;
        }
      }
    }

    return participants.map(p => {
      const s = shares.get(p.id!) ?? { share: 0, paidSelf: 0 };
      return {
        participant: p,
        totalShare: s.share,
        paidSelf: s.paidSelf,
        owesOrganizer: Math.max(0, s.share - s.paidSelf),
      };
    });
  }

  pct(amount: number, total: number): number {
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }
}
