import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

/**
 * Static legal pages (/privacy and /terms). One component; the route's
 * `data.page` picks which document renders. Publicly reachable (no auth
 * guard) so the login page can link here.
 */
@Component({
  selector: 'app-legal',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatButtonModule],
  templateUrl: './legal.component.html',
  styleUrl: './legal.component.scss',
})
export class LegalComponent {
  readonly page: 'privacy' | 'terms' = inject(ActivatedRoute).snapshot.data['page'] ?? 'privacy';
  readonly updated = 'July 2, 2026';
}
