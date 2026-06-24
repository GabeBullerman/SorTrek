import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';
import { ThemeToggleComponent } from '../../shared/components/theme-toggle/theme-toggle.component';
import { Timestamp } from '@angular/fire/firestore';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { CurrencyConverterComponent } from '../../shared/components/currency-converter/currency-converter.component';
import { GuideModalComponent } from '../../shared/components/guide-modal/guide-modal.component';
import { PwaInstallPromptComponent } from '../../shared/components/pwa-install-prompt/pwa-install-prompt.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatButtonModule,
    MatIconModule, MatListModule, MatMenuModule, MatTooltipModule,
    AsyncPipe, CurrencyConverterComponent, PwaInstallPromptComponent,
    ThemeToggleComponent,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent implements OnInit {
  private auth = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);
  private breakpointObserver = inject(BreakpointObserver);
  private dialog = inject(MatDialog);

  @ViewChild('sidenav') sidenav!: MatSidenav;

  currentUser$ = this.auth.currentUser$;

  ngOnInit() {
    // Ensure every logged-in user has a Firestore profile.
    // Covers accounts created before profile-creation was added and Google sign-ins that failed to write.
    this.auth.currentUser$.pipe(
      filter(u => !!u),
      take(1),
      switchMap(user =>
        this.userService.getProfile(user!.uid).pipe(
          take(1),
          filter(profile => !profile),
          map(() => user!)
        )
      )
    ).subscribe(user => {
      this.userService.createProfile({
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Traveller',
        email: user.email || '',
        photoURL: user.photoURL || undefined,
        homeCurrency: 'USD',
        country: 'United States',
        createdAt: Timestamp.now(),
      });
    });
  }
  isMobile$ = this.breakpointObserver.observe([Breakpoints.Handset]).pipe(map(r => r.matches));

  navItems = [
    { label: 'My Trips',   icon: 'flight_takeoff', route: '/trips' },
    { label: 'Past Trips', icon: 'history',         route: '/past-trips' },
    { label: 'Profile',    icon: 'account_circle',  route: '/profile' },
  ];

  logout() {
    this.auth.logout().subscribe(() => this.router.navigate(['/auth/login']));
  }

  openGuide() {
    this.dialog.open(GuideModalComponent, {
      panelClass: 'guide-dialog-panel',
      maxWidth: '720px',
      width: '95vw',
    });
  }
}
