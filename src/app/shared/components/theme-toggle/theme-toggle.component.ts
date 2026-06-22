import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * Animated light/dark theme switch — the "Within" toggle from the
 * (MIT-licensed) theme-toggles set, reimplemented natively in Angular.
 * The SVG morphs sun ⇄ moon purely via CSS transforms that activate when
 * `<html>` has the `.dark` class (set by ThemeService).
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [MatButtonModule, MatTooltipModule],
  template: `
    <button mat-icon-button type="button" class="theme-toggle-btn"
            (click)="theme.toggle()"
            [matTooltip]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'"
            [attr.aria-label]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'">
      <svg class="within" width="24" height="24" viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
        <clipPath id="theme-toggle-within-clip">
          <path d="M0 0h32v32h-32ZM6 16A1 1 0 0026 16 1 1 0 006 16" />
        </clipPath>
        <g clip-path="url(#theme-toggle-within-clip)">
          <path class="within-ray" d="M30.7 21.3 27.1 16l3.7-5.3c.4-.5.1-1.3-.6-1.4l-6.3-1.1-1.1-6.3c-.1-.6-.8-.9-1.4-.6L16 5l-5.4-3.7c-.5-.4-1.3-.1-1.4.6l-1 6.3-6.4 1.1c-.6.1-.9.9-.6 1.3L4.9 16l-3.7 5.3c-.4.5-.1 1.3.6 1.4l6.3 1.1 1.1 6.3c.1.6.8.9 1.4.6l5.3-3.7 5.3 3.7c.5.4 1.3.1 1.4-.6l1.1-6.3 6.3-1.1c.8-.1 1.1-.8.7-1.4zM16 25.1c-5.1 0-9.1-4.1-9.1-9.1 0-5.1 4.1-9.1 9.1-9.1s9.1 4.1 9.1 9.1c0 5.1-4 9.1-9.1 9.1z" />
        </g>
        <path class="within-ring" d="M16 7.7c-4.6 0-8.2 3.7-8.2 8.2s3.6 8.4 8.2 8.4 8.2-3.7 8.2-8.2-3.6-8.4-8.2-8.4zm0 14.4c-3.4 0-6.1-2.9-6.1-6.2s2.7-6.1 6.1-6.1c3.4 0 6.1 2.9 6.1 6.2s-2.7 6.1-6.1 6.1z" />
        <path class="within-inner" d="M16 9.5c-3.6 0-6.4 2.9-6.4 6.4s2.8 6.5 6.4 6.5 6.4-2.9 6.4-6.4-2.8-6.5-6.4-6.5z" />
      </svg>
    </button>
  `,
  styles: [`
    /* Always white — the toggle lives on the dark-blue brand toolbar in both
       themes, so don't inherit Material's theme-dependent default icon color. */
    .theme-toggle-btn { color: var(--st-brand-contrast); }
    .within { display: block; }
    .within path {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 500ms cubic-bezier(0, 0, 0, 1.25);
    }
    /* Dark state: rays shrink, ring grows, inner disc slides up-right → crescent moon */
    :host-context(.dark) .within-ray   { transform: scale(0.65); }
    :host-context(.dark) .within-ring  { transform: scale(1.5); }
    :host-context(.dark) .within-inner { transform: translate3d(3px, -3px, 0) scale(1.2); }
  `],
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemeService);
}
