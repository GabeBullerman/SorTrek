import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

const DISMISSED_KEY = 'pwa-install-prompt-dismissed';

@Component({
  selector: 'app-pwa-install-prompt',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatSnackBarModule],
  template: `
    @if (showBanner) {
      <div class="pwa-banner" role="banner" aria-label="Install app banner">
        <mat-icon class="pwa-icon">install_mobile</mat-icon>
        <span class="pwa-message">Install Wayfarer for offline access</span>
        <div class="pwa-actions">
          <button mat-flat-button color="primary" (click)="install()">Install</button>
          <button mat-icon-button (click)="dismiss()" aria-label="Dismiss install prompt">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pwa-banner {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--mat-sys-surface-container-high, #1a237e);
      color: #fff;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      z-index: 9999;
      max-width: calc(100vw - 32px);
      width: max-content;
    }

    .pwa-icon {
      flex-shrink: 0;
    }

    .pwa-message {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
    }

    .pwa-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    @media (max-width: 480px) {
      .pwa-banner {
        flex-wrap: wrap;
        width: calc(100vw - 32px);
      }
    }
  `],
})
export class PwaInstallPromptComponent implements OnInit, OnDestroy {
  showBanner = false;

  private deferredPrompt: any = null;
  private boundHandler = this.onBeforeInstallPrompt.bind(this);

  ngOnInit(): void {
    if (localStorage.getItem(DISMISSED_KEY)) {
      return;
    }
    window.addEventListener('beforeinstallprompt', this.boundHandler);
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeinstallprompt', this.boundHandler);
  }

  private onBeforeInstallPrompt(event: Event): void {
    event.preventDefault();
    this.deferredPrompt = event;
    this.showBanner = true;
  }

  install(): void {
    if (!this.deferredPrompt) return;
    this.deferredPrompt.prompt();
    this.deferredPrompt.userChoice.then((choice: { outcome: string }) => {
      if (choice.outcome === 'accepted') {
        this.showBanner = false;
      }
      this.deferredPrompt = null;
    });
  }

  dismiss(): void {
    this.showBanner = false;
    localStorage.setItem(DISMISSED_KEY, '1');
  }
}
