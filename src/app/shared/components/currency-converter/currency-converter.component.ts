import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CurrencyService } from '../../../core/services/currency.service';
import { CURRENCIES } from '../../../features/profile/profile.component';

@Component({
  selector: 'app-currency-converter',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  templateUrl: './currency-converter.component.html',
  styleUrl: './currency-converter.component.scss',
})
export class CurrencyConverterComponent {
  private currencyService = inject(CurrencyService);

  readonly currencies = CURRENCIES;

  amount    = signal(100);
  fromCode  = signal('USD');
  toCode    = signal('EUR');
  result    = signal<number | null>(null);
  loading   = signal(false);
  rateInfo  = signal<string>('');

  convert() {
    const a = this.amount();
    if (!a || a <= 0) return;
    this.loading.set(true);
    this.result.set(null);

    this.currencyService.getRate(this.fromCode(), this.toCode()).subscribe(r => {
      this.loading.set(false);
      if (r) {
        this.result.set(a * r.rate);
        this.rateInfo.set(`1 ${r.from} = ${r.rate.toFixed(4)} ${r.to}`);
      }
    });
  }

  swap() {
    const tmp = this.fromCode();
    this.fromCode.set(this.toCode());
    this.toCode.set(tmp);
    this.result.set(null);
  }

  formatResult(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
