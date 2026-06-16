import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, combineLatest, map, catchError, of, from, forkJoin } from 'rxjs';
import { CURRENCIES } from '../../profile/profile.component';
import { MoneyComponent } from '../../../shared/components/money/money.component';
import { PlaidService, PlaidTransaction } from '../../../core/services/plaid.service';
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

interface GlanceRate {
  code: string;
  flag: string;
  rate: number | null;
  loading: boolean;
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
    FormsModule,
    MatCardModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatDividerModule, MatTooltipModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
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
  private plaidService = inject(PlaidService);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  costs$!: Observable<CostsData>;
  homeCurrency = signal<string | null>(null);
  rateResult = signal<RateResult | null>(null);
  loadingRate = signal(false);
  showConverted = signal(false);
  readonly feeRate = FOREIGN_TX_FEE;

  // Currency Tools panel
  readonly currencies = CURRENCIES;
  showConverterPanel = signal(false);
  converterAmount = signal<number>(100);
  converterFrom = signal<string>('USD');
  converterTo = signal<string>('USD');
  converterResult = signal<RateResult | null>(null);
  converterLoading = signal(false);
  glanceRates = signal<GlanceRate[]>([]);
  glanceLoading = signal(false);

  readonly commonAmounts = [10, 20, 50, 100, 200, 500];
  readonly glanceCurrencies: { code: string; flag: string }[] = [
    { code: 'USD', flag: '🇺🇸' },
    { code: 'EUR', flag: '🇪🇺' },
    { code: 'GBP', flag: '🇬🇧' },
    { code: 'JPY', flag: '🇯🇵' },
    { code: 'CAD', flag: '🇨🇦' },
  ];

  plaidConnected = signal(false);
  plaidConnecting = signal(false);
  plaidTransactions = signal<PlaidTransaction[]>([]);
  loadingTransactions = signal(false);
  showTransactions = signal(false);

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

    // Pre-fill converter with trip currency → home currency
    this.converterFrom.set(this.trip.currency ?? 'USD');

    const uid = this.auth.currentUser?.uid;
    if (uid) {
      this.userService.getProfile(uid).subscribe(profile => {
        if (profile?.homeCurrency) {
          this.homeCurrency.set(profile.homeCurrency);
          this.converterTo.set(profile.homeCurrency);
        }
      });
    }

    this.plaidService.isConnected().subscribe(c => this.plaidConnected.set(c));
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

  toggleConverterPanel() {
    const opening = !this.showConverterPanel();
    this.showConverterPanel.set(opening);
    if (opening) {
      this.runQuickConvert();
      this.loadGlanceRates();
    }
  }

  runQuickConvert() {
    const from = this.converterFrom();
    const to = this.converterTo();
    if (!from || !to) return;
    this.converterLoading.set(true);
    this.converterResult.set(null);
    this.currencyService.getRate(from, to).subscribe(r => {
      this.converterResult.set(r);
      this.converterLoading.set(false);
    });
  }

  swapConverter() {
    const tmp = this.converterFrom();
    this.converterFrom.set(this.converterTo());
    this.converterTo.set(tmp);
    this.converterResult.set(null);
    this.runQuickConvert();
  }

  converterResultAmount(): number | null {
    const r = this.converterResult();
    if (!r) return null;
    return this.converterAmount() * r.rate;
  }

  quickAmountConverted(amount: number): number | null {
    const r = this.converterResult();
    if (!r) return null;
    return amount * r.rate;
  }

  formatRate(n: number): string {
    // JPY and similar high-value pairs look better with fewer decimals
    if (n >= 100) return n.toFixed(2);
    if (n >= 10)  return n.toFixed(3);
    return n.toFixed(4);
  }

  loadGlanceRates() {
    const tripCcy = this.trip.currency;
    const home    = this.homeCurrency();
    const targets = this.glanceCurrencies.filter(
      c => c.code !== tripCcy && c.code !== home
    ).slice(0, 5);

    this.glanceLoading.set(true);
    const init: GlanceRate[] = targets.map(c => ({ ...c, rate: null, loading: true }));
    this.glanceRates.set(init);

    const reqs = targets.map(c => this.currencyService.getRate(tripCcy, c.code));
    forkJoin(reqs).subscribe(results => {
      const updated: GlanceRate[] = targets.map((c, i) => ({
        ...c,
        rate: results[i]?.rate ?? null,
        loading: false,
      }));
      this.glanceRates.set(updated);
      this.glanceLoading.set(false);
    });
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

  connectBank() {
    this.plaidConnecting.set(true);
    this.plaidService.openLink().subscribe(success => {
      this.plaidConnecting.set(false);
      if (success) {
        this.plaidConnected.set(true);
        this.snackBar.open('Bank connected! Loading transactions…', undefined, { duration: 3000 });
        this.fetchTransactions();
      }
    });
  }

  fetchTransactions() {
    this.loadingTransactions.set(true);
    this.showTransactions.set(true);
    const start = this.trip.startDate.toDate().toISOString().split('T')[0];
    const end   = this.trip.endDate.toDate().toISOString().split('T')[0];
    this.plaidService.getTransactions(start, end).subscribe(txs => {
      this.plaidTransactions.set(txs);
      this.loadingTransactions.set(false);
    });
  }

  disconnectBank() {
    this.plaidService.disconnect().subscribe(() => {
      this.plaidConnected.set(false);
      this.plaidTransactions.set([]);
      this.showTransactions.set(false);
      this.snackBar.open('Bank disconnected', undefined, { duration: 2500 });
    });
  }

  addTransactionAsExpense(tx: PlaidTransaction) {
    from(this.expenseService.createExpense({
      tripId: this.tripId,
      title: tx.merchant || tx.name,
      amount: Math.abs(tx.amount),
      currency: tx.currency,
      category: this.mapPlaidCategory(tx.category),
      notes: `Imported from bank — ${tx.date}`,
    })).subscribe(() =>
      this.snackBar.open(`"${tx.name}" added to expenses`, undefined, { duration: 2000 })
    );
  }

  private mapPlaidCategory(category: string): import('../../../core/models/expense.model').ExpenseCategory {
    const c = category.toLowerCase();
    if (c.includes('food') || c.includes('restaurant') || c.includes('dining')) return 'food';
    if (c.includes('travel') || c.includes('transport') || c.includes('taxi') || c.includes('airline')) return 'transport';
    if (c.includes('hotel') || c.includes('lodging') || c.includes('accommodation')) return 'accommodation';
    if (c.includes('shop') || c.includes('retail') || c.includes('store')) return 'shopping';
    return 'other';
  }

  pct(amount: number, total: number): number {
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }
}
