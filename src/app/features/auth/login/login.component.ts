import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { signal } from '@angular/core';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  hidePassword = signal(true);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  private afterLogin() {
    const token = localStorage.getItem('pendingInviteToken');
    if (token) {
      localStorage.removeItem('pendingInviteToken');
      this.router.navigate(['/invite', token]);
    } else {
      this.router.navigate(['/trips']);
    }
  }

  submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    const { email, password } = this.form.value;
    this.auth.login(email!, password!).subscribe({
      next: () => this.afterLogin(),
      error: err => {
        this.loading.set(false);
        this.snackBar.open(this.friendlyError(err.code), 'Dismiss', { duration: 4000 });
      },
    });
  }

  googleLoading = signal(false);

  loginWithGoogle() {
    this.googleLoading.set(true);
    this.auth.loginWithGoogle().subscribe({
      next: () => this.afterLogin(),
      error: err => {
        this.googleLoading.set(false);
        if (err.code !== 'auth/popup-closed-by-user') {
          this.snackBar.open('Google sign-in failed. Please try again.', 'Dismiss', { duration: 4000 });
        }
      },
    });
  }

  private friendlyError(code: string): string {
    const map: Record<string, string> = {
      'auth/user-not-found': 'No account found with that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Invalid email or password.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
    };
    return map[code] ?? 'Login failed. Please try again.';
  }
}
