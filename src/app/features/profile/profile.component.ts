import { Component, inject, signal, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { updateProfile } from '@angular/fire/auth';
import { Auth } from '@angular/fire/auth';
import { Timestamp } from '@angular/fire/firestore';
import { from } from 'rxjs';
import { UserService } from '../../core/services/user.service';
import { PushNotificationService } from '../../core/services/push-notification.service';
import { GoogleMapsLoaderService } from '../../core/services/google-maps-loader.service';
import { ThemeService, PALETTES, ThemePalette, ThemeMode } from '../../core/services/theme.service';
import { UserPreferencesService } from '../../core/services/user-preferences.service';

export const CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'CNY', label: 'CNY — Chinese Yuan' },
  { code: 'MXN', label: 'MXN — Mexican Peso' },
  { code: 'BRL', label: 'BRL — Brazilian Real' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'KRW', label: 'KRW — South Korean Won' },
  { code: 'SGD', label: 'SGD — Singapore Dollar' },
  { code: 'NOK', label: 'NOK — Norwegian Krone' },
  { code: 'SEK', label: 'SEK — Swedish Krona' },
  { code: 'DKK', label: 'DKK — Danish Krone' },
  { code: 'NZD', label: 'NZD — New Zealand Dollar' },
  { code: 'ZAR', label: 'ZAR — South African Rand' },
  { code: 'AED', label: 'AED — UAE Dirham' },
  { code: 'THB', label: 'THB — Thai Baht' },
];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatSlideToggleModule, MatButtonToggleModule,
    MatProgressSpinnerModule, MatDividerModule, MatTooltipModule,
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit, AfterViewInit {
  private auth          = inject(Auth);
  private userService   = inject(UserService);
  readonly pushService  = inject(PushNotificationService);
  private mapsLoader    = inject(GoogleMapsLoaderService);
  private snackBar      = inject(MatSnackBar);
  private fb            = inject(FormBuilder);
  readonly theme        = inject(ThemeService);
  readonly prefs        = inject(UserPreferencesService);

  readonly palettes = PALETTES;

  @ViewChild('homeCityInput') homeCityInputRef!: ElementRef<HTMLInputElement>;

  readonly currencies = CURRENCIES;
  saving     = signal(false);
  loading    = signal(true);
  notifPerm  = signal<NotificationPermission>('default');

  form = this.fb.group({
    displayName:  ['', Validators.required],
    homeCity:     [''],
    homeCurrency: ['USD', Validators.required],
  });

  ngOnInit() {
    this.notifPerm.set(this.pushService.permission);
    const user = this.auth.currentUser;
    if (!user) { this.loading.set(false); return; }

    this.userService.getProfile(user.uid).subscribe(profile => {
      this.form.patchValue({
        displayName:  profile?.displayName ?? user.displayName ?? '',
        homeCity:     profile?.homeCity    ?? '',
        homeCurrency: profile?.homeCurrency ?? 'USD',
      });
      this.loading.set(false);
    });
  }

  ngAfterViewInit() {
    this.mapsLoader.load().subscribe(loaded => {
      if (!loaded || !this.homeCityInputRef) return;
      const autocomplete = new (window as any).google.maps.places.Autocomplete(
        this.homeCityInputRef.nativeElement,
        { types: ['(cities)'] }
      );
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        const name = place.formatted_address ?? place.name ?? '';
        this.form.patchValue({ homeCity: name });
      });
    });
  }

  get user() { return this.auth.currentUser; }

  get initial(): string {
    const name = this.user?.displayName ?? this.user?.email ?? '?';
    return name.charAt(0).toUpperCase();
  }

  async save() {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    const uid = this.user!.uid;

    try {
      await updateProfile(this.user!, { displayName: v.displayName! });
      await this.userService.updateProfile(uid, {
        displayName:  v.displayName!,
        homeCity:     v.homeCity ?? undefined,
        homeCurrency: v.homeCurrency!,
      });
      this.snackBar.open('Profile saved', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Failed to save profile', undefined, { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  async enableNotifications() {
    const granted = await this.pushService.requestPermission();
    this.notifPerm.set(this.pushService.permission);
    if (granted) {
      await this.userService.updateProfile(this.user!.uid, { notificationsEnabled: true });
      this.snackBar.open('Push notifications enabled!', undefined, { duration: 3000 });
    } else {
      this.snackBar.open('Notification permission denied', undefined, { duration: 3000 });
    }
  }

  testNotification() {
    this.pushService.send(
      'SorTrek Test',
      'Push notifications are working correctly 🎉',
    );
  }

  setMode(mode: ThemeMode) {
    this.theme.setMode(mode);
  }

  setPalette(id: ThemePalette) {
    this.theme.setPalette(id);
  }

  toggleAi(on: boolean) {
    this.prefs.setAiEnabled(on);
  }

  toggleReminders(on: boolean) {
    this.prefs.setRemindersEnabled(on);
  }
}
