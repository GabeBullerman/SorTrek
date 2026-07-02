import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-delete-account-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title class="danger-title"><mat-icon>warning</mat-icon> Delete account</h2>
    <mat-dialog-content>
      <p>This <strong>permanently erases everything</strong> tied to your account:</p>
      <ul class="erase-list">
        <li>Trips you own — including everyone's bookings, schedule, expenses and packing lists in them</li>
        <li>Photos and documents you uploaded to any trip</li>
        <li>Your connected bank (Plaid) access</li>
        <li>Your profile, preferences and notification tokens</li>
      </ul>
      <p class="keep-note">Expenses you logged in trips owned by others stay, so their cost splits still add up.</p>

      @if (isPasswordAccount) {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Enter your password to confirm</mat-label>
          <input matInput [type]="showPw() ? 'text' : 'password'" [(ngModel)]="password"
                 autocomplete="current-password" [disabled]="working()">
          <button mat-icon-button matSuffix type="button" (click)="showPw.set(!showPw())"
                  [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'">
            <mat-icon>{{ showPw() ? 'visibility_off' : 'visibility' }}</mat-icon>
          </button>
        </mat-form-field>
      } @else {
        <p class="google-note"><mat-icon>info</mat-icon>
          You signed in with Google — you'll be asked to confirm through a Google popup.</p>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Type your email to confirm</mat-label>
          <input matInput type="email" [(ngModel)]="emailConfirm" [disabled]="working()"
                 [placeholder]="email">
        </mat-form-field>
      }

      @if (error()) { <p class="error-text">{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="working()">Cancel</button>
      <button mat-flat-button color="warn" (click)="confirmDelete()" [disabled]="!canDelete || working()">
        @if (working()) { <mat-spinner diameter="18"></mat-spinner> Deleting… }
        @else { <ng-container><mat-icon>delete_forever</mat-icon> Delete forever</ng-container> }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .danger-title { display: flex; align-items: center; gap: 8px; color: var(--mat-sys-error, #b3261e); }
    .erase-list { margin: 8px 0; padding-left: 20px; li { margin-bottom: 4px; } }
    .keep-note { font-size: 0.85rem; opacity: 0.75; }
    .full-width { width: 100%; margin-top: 8px; }
    .google-note { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; opacity: 0.8;
                   mat-icon { font-size: 18px; width: 18px; height: 18px; } }
    .error-text { color: var(--mat-sys-error, #b3261e); font-size: 0.85rem; }
    mat-dialog-content { max-width: 440px; }
  `],
})
export class DeleteAccountDialogComponent {
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private dialogRef = inject(MatDialogRef<DeleteAccountDialogComponent>);

  password = '';
  emailConfirm = '';
  showPw = signal(false);
  working = signal(false);
  error = signal('');

  readonly isPasswordAccount = this.authService.primaryProvider === 'password';
  readonly email = this.authService.currentUser?.email ?? '';

  get canDelete(): boolean {
    return this.isPasswordAccount
      ? this.password.length > 0
      : this.emailConfirm.trim().toLowerCase() === this.email.toLowerCase();
  }

  async confirmDelete() {
    this.working.set(true);
    this.error.set('');
    try {
      // Prove presence (password / Google popup) and refresh the ID token so
      // the server sees a fresh auth_time.
      await this.authService.reauthenticate(this.isPasswordAccount ? this.password : undefined);
      await this.authService.currentUser?.getIdToken(true);

      await firstValueFrom(this.http.post('/api/delete-account', {}));

      // Server already deleted the Auth user — clear everything local.
      await this.authService.logout();
      this.dialogRef.close(true);
      window.location.href = '/auth/login';
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code.includes('wrong-password') || code.includes('invalid-credential')) {
        this.error.set('Incorrect password.');
      } else if (code.includes('popup-closed')) {
        this.error.set('Google confirmation was cancelled.');
      } else {
        this.error.set('Account deletion failed. Please try again.');
      }
      this.working.set(false);
    }
  }
}
