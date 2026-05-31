import { Component, Input, inject, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { UserCurrencyService } from '../../../core/services/user-currency.service';

@Component({
  selector: 'app-money',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <span class="money-primary">{{ formatted() }}</span>
    @if (converted() !== null) {
      <span class="money-secondary">~{{ convertedFormatted() }} {{ homeCurrency() }}</span>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; line-height: 1.25; }
    .money-primary  { font-variant-numeric: tabular-nums; }
    .money-secondary {
      font-size: 0.72em;
      color: #9e9e9e;
      font-weight: 400;
    }
  `],
})
export class MoneyComponent {
  @Input() amount!: number;
  @Input() currency!: string;

  private userCurrency = inject(UserCurrencyService);

  readonly homeCurrency = this.userCurrency.homeCurrency;

  readonly converted = computed(() => this.userCurrency.convert(this.amount, this.currency));

  readonly formatted = computed(() => this.formatCurrency(this.amount, this.currency));

  readonly convertedFormatted = computed(() => {
    const c = this.converted();
    return c !== null ? this.formatCurrency(c, this.homeCurrency()!) : '';
  });

  private formatCurrency(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(0)}`;
    }
  }
}
