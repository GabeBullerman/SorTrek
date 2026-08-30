import { Component, HostListener, Input, OnInit, inject, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { AsyncPipe, DecimalPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PhotoService } from '../../../core/services/photo.service';
import { AuthService } from '../../../core/services/auth.service';
import { Photo } from '../../../core/models/photo.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { Observable, of, from } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** How long a press has to be held before it turns into a selection. */
const LONG_PRESS_MS = 450;
/** Movement past this many px is a scroll, not a hold. */
const LONG_PRESS_SLOP_PX = 10;
/** Transient image errors are retried this many times before the tile gives up. */
const MAX_IMAGE_RETRIES = 2;

@Component({
  selector: 'app-photos',
  standalone: true,
  imports: [
    AsyncPipe, DecimalPipe, DatePipe,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatProgressSpinnerModule, MatFormFieldModule, MatInputModule, MatTooltipModule,
  ],
  templateUrl: './photos.component.html',
  styleUrl: './photos.component.scss',
})
export class PhotosComponent implements OnInit {
  @Input() tripId!: string;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private photoService = inject(PhotoService);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  photos$!: Observable<Photo[]>;
  readonly currentUserId = this.auth.currentUser?.uid ?? '';

  ngOnInit() {
    this.photos$ = this.photoService.getPhotos(this.tripId).pipe(
      catchError(err => { console.error('Photos query failed:', err); return of([]); })
    );
  }

  uploadProgress = signal<number | null>(null);
  uploadCaption = signal('');
  lightboxPhoto = signal<Photo | null>(null);

  /** Selection ("hold to select") state. */
  selectionMode = signal(false);
  private selectedIds = signal<ReadonlySet<string>>(new Set());
  selectedCount = computed(() => this.selectedIds().size);
  saving = signal(false);

  /** The photos currently ticked, in album order. */
  private selectedFrom(photos: Photo[]): Photo[] {
    const ids = this.selectedIds();
    return photos.filter(p => p.id && ids.has(p.id));
  }

  /** Per-photo retry counters for images that failed to load. An error is not
   *  proof the file is gone — an expired token, a dropped connection or a
   *  throttled batch load all look the same — so we retry before giving up,
   *  and never delete anything on our own. */
  private retries = signal<ReadonlyMap<string, number>>(new Map());
  /** IDs that still failed after every retry. Shown as a placeholder tile. */
  private unloadable = signal<ReadonlySet<string>>(new Set());

  isUnloadable(id?: string): boolean {
    return !!id && this.unloadable().has(id);
  }

  /** Cache-busted src so a retry actually re-requests the bytes. */
  srcFor(photo: Photo): string {
    const attempt = (photo.id && this.retries().get(photo.id)) || 0;
    return attempt ? `${photo.url}${photo.url.includes('?') ? '&' : '?'}_retry=${attempt}` : photo.url;
  }

  isSelected(id?: string): boolean {
    return !!id && this.selectedIds().has(id);
  }

  visibleCount(photos: Photo[]): number {
    return photos.length;
  }

  ownedCount(photos: Photo[]): number {
    return this.selectedFrom(photos).filter(p => p.userId === this.currentUserId).length;
  }

  triggerUpload() {
    this.fileInput.nativeElement.click();
  }

  onFilesSelected(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (!files?.length) return;
    Array.from(files).forEach(file => this.uploadFile(file));
    (event.target as HTMLInputElement).value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) this.uploadFile(file);
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  private uploadFile(file: File) {
    this.uploadProgress.set(0);
    this.photoService.uploadPhoto(this.tripId, file, this.uploadCaption()).subscribe({
      next: progress => this.uploadProgress.set(progress),
      complete: () => {
        this.uploadProgress.set(null);
        this.snackBar.open('Photo uploaded!', undefined, { duration: 2000 });
      },
      error: () => {
        this.uploadProgress.set(null);
        this.snackBar.open('Upload failed', 'Dismiss', { duration: 3000 });
      },
    });
  }

  /* ── Selection ───────────────────────────────────────────────────────────── */

  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressOrigin: { x: number; y: number } | null = null;
  /** Set when a hold fires, so the click that follows it doesn't also act. */
  private suppressNextClick = false;

  /** Press-and-hold a tile to start selecting. */
  onTilePointerDown(event: PointerEvent, photo: Photo) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Let the overlay's own buttons (save/delete) behave like buttons.
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    this.suppressNextClick = false;
    this.pressOrigin = { x: event.clientX, y: event.clientY };
    this.cancelPressTimer();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.suppressNextClick = true;
      if (this.selectionMode()) this.toggleSelection(photo);
      else this.enterSelection(photo);
    }, LONG_PRESS_MS);
  }

  onTilePointerMove(event: PointerEvent) {
    if (!this.pressTimer || !this.pressOrigin) return;
    const moved = Math.hypot(event.clientX - this.pressOrigin.x, event.clientY - this.pressOrigin.y);
    if (moved > LONG_PRESS_SLOP_PX) this.cancelPressTimer();
  }

  onTilePointerUp() {
    this.cancelPressTimer();
  }

  private cancelPressTimer() {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }

  /** Swallow the long-press context menu on touch/pen so the hold selects. */
  onTileContextMenu(event: Event): boolean {
    if (this.selectionMode()) { event.preventDefault(); return false; }
    return true;
  }

  private enterSelection(photo: Photo) {
    if (!photo.id) return;
    this.selectionMode.set(true);
    this.selectedIds.set(new Set([photo.id]));
    if ('vibrate' in navigator) navigator.vibrate?.(10);
  }

  /** A tap: toggles while selecting, opens the lightbox otherwise. */
  onTileClick(photo: Photo) {
    if (this.suppressNextClick) { this.suppressNextClick = false; return; }
    if (this.selectionMode()) { this.toggleSelection(photo); return; }
    this.openLightbox(photo);
  }

  toggleSelection(photo: Photo) {
    if (!photo.id) return;
    const next = new Set(this.selectedIds());
    if (next.has(photo.id)) next.delete(photo.id); else next.add(photo.id);
    this.selectedIds.set(next);
    if (next.size === 0) this.selectionMode.set(false);
  }

  startSelection() {
    this.selectionMode.set(true);
    this.selectedIds.set(new Set());
  }

  exitSelection() {
    this.selectionMode.set(false);
    this.selectedIds.set(new Set());
  }

  selectAll(photos: Photo[]) {
    this.selectedIds.set(new Set(photos.map(p => p.id).filter((id): id is string => !!id)));
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.selectionMode()) this.exitSelection();
  }

  /* ── Saving to the device ────────────────────────────────────────────────── */

  async saveSelected(photos: Photo[]) {
    const chosen = this.selectedFrom(photos);
    if (!chosen.length || this.saving()) return;
    this.saving.set(true);
    try {
      const saved = await this.photoService.savePhotos(chosen);
      this.snackBar.open(
        `Saved ${saved} photo${saved === 1 ? '' : 's'} to your device`, undefined, { duration: 2500 });
      this.exitSelection();
    } catch {
      this.snackBar.open('Could not save photos', 'Dismiss', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  async savePhoto(photo: Photo) {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.photoService.savePhoto(photo);
      this.snackBar.open('Saved to your device', undefined, { duration: 2000 });
    } catch {
      this.snackBar.open('Could not save photo', 'Dismiss', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  /* ── Lightbox ────────────────────────────────────────────────────────────── */

  openLightbox(photo: Photo) {
    this.lightboxPhoto.set(photo);
  }

  closeLightbox() {
    this.lightboxPhoto.set(null);
  }

  /* ── Broken images ───────────────────────────────────────────────────────── */

  /** Retry a failed image a couple of times before showing a placeholder.
   *  Nothing is deleted automatically — a load error is not proof the file is
   *  missing, and auto-purging on one silently shrank shared albums. */
  onImageLoadError(photo: Photo) {
    if (!photo.id || this.unloadable().has(photo.id)) return;
    const attempts = (this.retries().get(photo.id) ?? 0) + 1;
    const retries = new Map(this.retries());
    retries.set(photo.id, attempts);
    this.retries.set(retries);
    if (attempts > MAX_IMAGE_RETRIES) {
      const failed = new Set(this.unloadable());
      failed.add(photo.id);
      this.unloadable.set(failed);
    }
  }

  /** Manual "try again" on a placeholder tile. */
  retryImage(photo: Photo) {
    if (!photo.id) return;
    const failed = new Set(this.unloadable());
    failed.delete(photo.id);
    this.unloadable.set(failed);
    const retries = new Map(this.retries());
    retries.set(photo.id, (retries.get(photo.id) ?? 0) + 1);
    this.retries.set(retries);
  }

  /** Explicitly drop a photo whose file really is gone. */
  removeBrokenPhoto(photo: Photo) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Remove Photo',
        message: 'This photo’s image could not be loaded. Remove it from the album?',
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed && photo.id) {
        from(this.photoService.purgeOrphanDoc(photo.id)).subscribe(() =>
          this.snackBar.open('Photo removed', undefined, { duration: 2000 })
        );
      }
    });
  }

  /* ── Deleting ────────────────────────────────────────────────────────────── */

  deletePhoto(photo: Photo) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Photo', message: 'Delete this photo? This cannot be undone.' },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.photoService.deletePhoto(photo)).subscribe(() =>
          this.snackBar.open('Photo deleted', undefined, { duration: 2000 })
        );
      }
    });
  }

  /** Delete the selected photos you uploaded; anyone else's are left alone. */
  deleteSelected(photos: Photo[]) {
    const mine = this.selectedFrom(photos).filter(p => p.userId === this.currentUserId);
    if (!mine.length) return;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete ${mine.length} Photo${mine.length === 1 ? '' : 's'}`,
        message: `Delete ${mine.length} photo${mine.length === 1 ? '' : 's'} you uploaded? This cannot be undone.`,
      },
    }).afterClosed().subscribe(async confirmed => {
      if (!confirmed) return;
      const results = await Promise.allSettled(mine.map(p => this.photoService.deletePhoto(p)));
      const failed = results.filter(r => r.status === 'rejected').length;
      this.snackBar.open(
        failed ? `Deleted ${mine.length - failed}, ${failed} failed` : `Deleted ${mine.length} photos`,
        failed ? 'Dismiss' : undefined,
        { duration: failed ? 3000 : 2000 });
      this.exitSelection();
    });
  }
}
