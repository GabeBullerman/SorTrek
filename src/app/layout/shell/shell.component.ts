import { Component, inject, signal, ViewChild } from '@angular/core';
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
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs/operators';
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
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private breakpointObserver = inject(BreakpointObserver);
  private dialog = inject(MatDialog);

  @ViewChild('sidenav') sidenav!: MatSidenav;

  currentUser$ = this.auth.currentUser$;
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
