import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { COUNTRIES } from '../../../core/data/countries';
import { Timestamp } from '@angular/fire/firestore';
import { from } from 'rxjs';

function passwordMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule,
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  hidePassword = signal(true);
  countries = COUNTRIES;

  form = this.fb.group({
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    country: ['', Validators.required],
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', Validators.required],
  }, { validators: passwordMatch });

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.loading.set(true);
    const { email, password, displayName, country } = this.form.value;
    const selectedCountry = this.countries.find(c => c.code === country)!;

    this.auth.register(email!, password!, displayName!).subscribe({
      next: (cred) => {
        from(this.userService.createProfile({
          uid: cred.user.uid,
          displayName: displayName!,
          email: email!,
          country: selectedCountry.name,
          homeCurrency: selectedCountry.currency,
          createdAt: Timestamp.now(),
        })).subscribe({
          next: () => this.afterLogin(),
          error: () => this.afterLogin(),
        });
      },
      error: err => {
        this.loading.set(false);
        const msg = err.code === 'auth/email-already-in-use'
          ? 'An account with that email already exists.'
          : 'Registration failed. Please try again.';
        this.snackBar.open(msg, 'Dismiss', { duration: 4000 });
      },
    });
  }

  private afterLogin() {
    const token = localStorage.getItem('pendingInviteToken');
    if (token) {
      localStorage.removeItem('pendingInviteToken');
      this.router.navigate(['/invite', token]);
    } else {
      this.router.navigate(['/trips']);
    }
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
}
