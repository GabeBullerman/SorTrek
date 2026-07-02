import { Component, Input, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { from } from 'rxjs';
import { IdeaService } from '../../../core/services/idea.service';
import { AuthService } from '../../../core/services/auth.service';
import { TripIdea } from '../../../core/models/trip-idea.model';
import { Trip } from '../../../core/models/trip.model';

@Component({
  selector: 'app-ideas',
  standalone: true,
  imports: [
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './ideas.component.html',
  styleUrl: './ideas.component.scss',
})
export class IdeasComponent implements OnInit {
  @Input() tripId!: string;
  @Input() trip!: Trip;

  private ideaService = inject(IdeaService);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  readonly currentUserId = this.auth.currentUser?.uid ?? '';

  ideas = signal<TripIdea[]>([]);
  loading = signal(true);
  newUrl = signal('');
  newNote = signal('');
  adding = signal(false);

  /** Newest first. */
  readonly sortedIdeas = computed(() =>
    [...this.ideas()].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
  );

  ngOnInit() {
    this.ideaService.getIdeas(this.tripId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ideas => {
        this.ideas.set(ideas);
        this.loading.set(false);
      });
  }

  /** Prepend https:// when someone pastes a bare "tiktok.com/…" link. */
  private normalizeUrl(raw: string): string | null {
    let url = raw.trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
      return url;
    } catch {
      return null;
    }
  }

  add() {
    const url = this.normalizeUrl(this.newUrl());
    if (!url) {
      this.snackBar.open('That doesn\'t look like a link — paste a full URL.', undefined, { duration: 3000 });
      return;
    }
    if (this.adding()) return;
    this.adding.set(true);

    // Fetch the preview first (best-effort), then save everything in one doc.
    this.ideaService.fetchPreview(url).subscribe(preview => {
      from(this.ideaService.createIdea({
        tripId: this.tripId,
        url,
        note: this.newNote().trim() || undefined,
        title: preview.title ?? undefined,
        description: preview.description ?? undefined,
        image: preview.image ?? undefined,
        siteName: preview.siteName ?? undefined,
        createdBy: this.currentUserId,
        creatorName: this.auth.currentUser?.displayName ?? 'Member',
      })).subscribe({
        next: () => {
          this.newUrl.set('');
          this.newNote.set('');
          this.adding.set(false);
        },
        error: () => {
          this.adding.set(false);
          this.snackBar.open('Could not save the idea. Please try again.', undefined, { duration: 3000 });
        },
      });
    });
  }

  /** Ids currently re-fetching their preview. */
  refreshing = signal<Set<string>>(new Set());

  /** Re-fetch the preview for an idea that saved without one. */
  refreshPreview(idea: TripIdea) {
    if (!idea.id || this.refreshing().has(idea.id)) return;
    this.refreshing.update(s => new Set([...s, idea.id!]));

    this.ideaService.fetchPreview(idea.url).subscribe(preview => {
      from(Promise.resolve(this.ideaService.updatePreview(idea.id!, preview))).subscribe({
        next: () => {
          this.refreshing.update(s => { const n = new Set(s); n.delete(idea.id!); return n; });
          if (!preview.image && !preview.title) {
            this.snackBar.open(
              'That site doesn\'t share a preview (Instagram requires login) — the link still works.',
              undefined, { duration: 4500 },
            );
          }
        },
        error: () => {
          this.refreshing.update(s => { const n = new Set(s); n.delete(idea.id!); return n; });
          this.snackBar.open('Could not update the preview.', undefined, { duration: 3000 });
        },
      });
    });
  }

  deleteIdea(idea: TripIdea) {
    from(this.ideaService.deleteIdea(idea.id!)).subscribe({
      error: () => this.snackBar.open('Could not remove the idea.', undefined, { duration: 3000 }),
    });
  }

  canDelete(idea: TripIdea): boolean {
    return idea.createdBy === this.currentUserId
      || this.trip.userId === this.currentUserId
      || (this.trip.ownerIds ?? []).includes(this.currentUserId);
  }

  /** Hostname shown on the site chip ("tiktok.com"). */
  host(idea: TripIdea): string {
    try { return new URL(idea.url).hostname.replace(/^www\./, ''); }
    catch { return idea.url; }
  }

  /** Small favicon for the source site (Google's public favicon service). */
  favicon(idea: TripIdea): string {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(this.host(idea))}&sz=64`;
  }

  /** Hide a preview image that fails to load (expired CDN links etc.). */
  onImgError(event: Event) {
    (event.target as HTMLElement).style.display = 'none';
  }
}
