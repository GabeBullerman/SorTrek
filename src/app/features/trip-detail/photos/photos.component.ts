import { Component, HostListener, Input, OnInit, inject, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsyncPipe, DecimalPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { PhotoService } from '../../../core/services/photo.service';
import { AuthService } from '../../../core/services/auth.service';
import { Photo } from '../../../core/models/photo.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { CaptionDialogComponent } from './caption-dialog/caption-dialog.component';
import { Observable, of, from } from 'rxjs';
import { catchError, shareReplay, tap } from 'rxjs/operators';

/** How long a press has to be held before it turns into a selection. */
const LONG_PRESS_MS = 450;
/** Movement past this many px is a scroll, not a hold. */
const LONG_PRESS_SLOP_PX = 10;
/** Transient image errors are retried this many times before the tile gives up. */
const MAX_IMAGE_RETRIES = 2;
/** A horizontal drag past this many px in the lightbox changes photo. */
const SWIPE_THRESHOLD_PX = 60;
/** Below this ratio the gesture is a vertical scroll, not a swipe. */
const SWIPE_HORIZONTAL_RATIO = 1.4;

@Component({
  selector: 'app-photos',
  standalone: true,
  imports: [
    AsyncPipe, DecimalPipe, DatePipe,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatProgressSpinnerModule, MatTooltipModule, MatFormFieldModule, MatInputModule,
    FormsModule,
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
      catchError(err => { console.error('Photos query failed:', err); return of([]); }),
      // Mirror the album into a signal so the lightbox can step through it
      // without the template having to hand it the list.
      tap(photos => this.album.set(photos)),
      // The grid and the floating selection pill both subscribe — share the one
      // Firestore listener between them instead of opening a second.
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    // The album is a set of Firestore records pointing at files in Storage, and
    // the two can drift apart. Reconcile once on open so photos still sitting in
    // the bucket come back on their own.
    void this.syncWithStorage(false);
  }

  uploadProgress = signal<number | null>(null);

  /** The album as last emitted, so the lightbox can move between photos. */
  private album = signal<Photo[]>([]);

  /** The open photo, tracked by id rather than position. The album is a live
   *  query — someone else uploading reorders it, and a stored index would then
   *  point at a different photo. An id survives that, and resolves to null if
   *  the photo is deleted, which closes the lightbox on its own. */
  private lightboxId = signal<string | null>(null);
  lightboxIndex = computed<number | null>(() => {
    const id = this.lightboxId();
    if (!id) return null;
    const i = this.album().findIndex(p => p.id === id);
    return i === -1 ? null : i;
  });
  lightboxPhoto = computed<Photo | null>(() => {
    const i = this.lightboxIndex();
    return i === null ? null : this.album()[i] ?? null;
  });
  lightboxCount = computed(() => this.album().length);
  hasPrev = computed(() => (this.lightboxIndex() ?? 0) > 0);
  hasNext = computed(() => {
    const i = this.lightboxIndex();
    return i !== null && i < this.album().length - 1;
  });

  /** Inline caption editing inside the lightbox. */
  editingCaption = signal(false);
  captionDraft = signal('');
  savingCaption = signal(false);

  syncing = signal(false);

  /** Reconcile the album against Storage. Quiet on open, chatty when the user
   *  asks for it explicitly from the header. */
  async syncWithStorage(announce: boolean) {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      const result = await this.photoService.syncWithStorage(this.tripId);
      if (result.restored > 0) {
        this.snackBar.open(
          `Recovered ${result.restored} photo${result.restored === 1 ? '' : 's'} from storage`,
          undefined, { duration: 3500 });
      } else if (announce) {
        this.snackBar.open(
          `Album is up to date — ${result.inAlbum} photo${result.inAlbum === 1 ? '' : 's'}, ` +
          `${result.inStorage} file${result.inStorage === 1 ? '' : 's'} in storage`,
          undefined, { duration: 4000 });
      }
    } catch (err) {
      console.error('Photo sync failed:', err);
      if (announce) {
        this.snackBar.open(
          (err as Error)?.message ?? 'Could not check storage for missing photos',
          'Dismiss', { duration: 4000 });
      }
    } finally {
      this.syncing.set(false);
    }
  }

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
    this.startBatch(files.length);
    Array.from(files).forEach(file => this.uploadFile(file));
    (event.target as HTMLInputElement).value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    this.startBatch(images.length);
    images.forEach(file => this.uploadFile(file));
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  /* ── Uploading ───────────────────────────────────────────────────────────── */

  /** The batch currently uploading. Captioning is offered once the whole batch
   *  lands, so picking twenty photos gets one prompt rather than twenty. */
  private batch: { remaining: number; ids: string[] } | null = null;

  private startBatch(count: number) {
    this.batch = { remaining: count, ids: [] };
  }

  private finishBatchItem(id?: string) {
    if (!this.batch) return;
    if (id) this.batch.ids.push(id);
    if (--this.batch.remaining > 0) return;

    const ids = this.batch.ids;
    this.batch = null;
    if (!ids.length) return;

    // Offered, never imposed: the snackbar times out on its own, and someone
    // dumping a hundred photos just lets it go.
    const ref = this.snackBar.open(
      `${ids.length} photo${ids.length === 1 ? '' : 's'} uploaded`,
      'Add captions', { duration: 6000 });
    ref.onAction().subscribe(() => this.selectByIds(ids));
  }

  private uploadFile(file: File) {
    this.uploadProgress.set(0);
    // Held per upload, not on the component: files upload in parallel, so a
    // shared field would let one file's id land in another's completion.
    let createdId: string | undefined;

    this.photoService.uploadPhoto(this.tripId, file).subscribe({
      next: event => {
        this.uploadProgress.set(event.percent);
        if (event.id) createdId = event.id;
      },
      complete: () => {
        this.uploadProgress.set(null);
        this.finishBatchItem(createdId);
      },
      error: () => {
        this.uploadProgress.set(null);
        this.finishBatchItem();
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
    this.photoService.prefetch(photo);
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
    if (next.has(photo.id)) {
      next.delete(photo.id);
    } else {
      next.add(photo.id);
      // Pull the bytes now so the Save tap can open the share sheet instantly —
      // iOS only allows that while the tap is still live.
      this.photoService.prefetch(photo);
    }
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
    photos.forEach(p => this.photoService.prefetch(p));
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.editingCaption()) { this.cancelCaptionEdit(); return; }
    if (this.lightboxId() !== null) { this.closeLightbox(); return; }
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
    if (!photo.id) return;
    this.lightboxId.set(photo.id);
    this.onLightboxPhotoChanged();
  }

  closeLightbox() {
    this.lightboxId.set(null);
    this.cancelCaptionEdit();
  }

  /** Step to another photo. Clamped at both ends — running off the end of the
   *  album silently wrapping around is disorienting. */
  showRelative(delta: number) {
    const i = this.lightboxIndex();
    if (i === null) return;
    const target = this.album()[i + delta];
    if (!target?.id) return;
    this.cancelCaptionEdit();
    this.lightboxId.set(target.id);
    this.onLightboxPhotoChanged();
  }

  /** Warm the bytes for the open photo (so Save is instant) and decode its
   *  neighbours, so a swipe lands on an image that's already there. */
  private onLightboxPhotoChanged() {
    const photo = this.lightboxPhoto();
    if (photo) this.photoService.prefetch(photo);

    const i = this.lightboxIndex();
    if (i === null) return;
    for (const neighbour of [this.album()[i - 1], this.album()[i + 1]]) {
      if (neighbour?.url) {
        const img = new Image();
        img.src = neighbour.url;
      }
    }
  }

  /* ── Swipe between photos ────────────────────────────────────────────────── */

  private swipeStart: { x: number; y: number } | null = null;

  onLightboxPointerDown(event: PointerEvent) {
    // Ignore anything starting on a control, and multi-touch (pinch to zoom).
    if ((event.target as HTMLElement | null)?.closest('button, input')) return;
    this.swipeStart = { x: event.clientX, y: event.clientY };
  }

  onLightboxPointerUp(event: PointerEvent) {
    const start = this.swipeStart;
    this.swipeStart = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return;

    // Drag left (negative dx) reveals the photo after this one.
    this.showRelative(dx < 0 ? 1 : -1);
  }

  onLightboxPointerCancel() {
    this.swipeStart = null;
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeft() {
    if (this.lightboxIndex() !== null && !this.editingCaption()) this.showRelative(-1);
  }

  @HostListener('document:keydown.arrowright')
  onArrowRight() {
    if (this.lightboxIndex() !== null && !this.editingCaption()) this.showRelative(1);
  }

  /* ── Captions ────────────────────────────────────────────────────────────── */

  /** Only the uploader may write a caption — firestore.rules allows an update
   *  just for the photo's own userId. */
  canCaption(photo: Photo | null): boolean {
    return !!photo && photo.userId === this.currentUserId;
  }

  startCaptionEdit() {
    const photo = this.lightboxPhoto();
    if (!this.canCaption(photo)) return;
    this.captionDraft.set(photo!.caption ?? '');
    this.editingCaption.set(true);
  }

  cancelCaptionEdit() {
    this.editingCaption.set(false);
    this.captionDraft.set('');
  }

  async saveCaptionEdit() {
    const photo = this.lightboxPhoto();
    if (!photo?.id || this.savingCaption()) return;
    const caption = this.captionDraft().trim();
    this.savingCaption.set(true);
    try {
      await this.photoService.updateCaption(photo.id, caption);
      this.editingCaption.set(false);
    } catch {
      this.snackBar.open('Could not save the caption', 'Dismiss', { duration: 3000 });
    } finally {
      this.savingCaption.set(false);
    }
  }

  /** Write one caption across the selected photos you uploaded. */
  captionSelected(photos: Photo[]) {
    const mine = this.selectedFrom(photos).filter(p => p.userId === this.currentUserId);
    if (!mine.length) return;

    this.dialog.open(CaptionDialogComponent, {
      data: { count: mine.length, caption: mine.length === 1 ? mine[0].caption ?? '' : '' },
    }).afterClosed().subscribe(async (caption?: string) => {
      if (caption === undefined) return;   // cancelled; '' deliberately clears
      const results = await Promise.allSettled(
        mine.map(p => this.photoService.updateCaption(p.id!, caption))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      this.snackBar.open(
        failed
          ? `Captioned ${mine.length - failed}, ${failed} failed`
          : `Captioned ${mine.length} photo${mine.length === 1 ? '' : 's'}`,
        failed ? 'Dismiss' : undefined,
        { duration: failed ? 3000 : 2000 });
      this.exitSelection();
    });
  }

  /** Select a specific set of photos — used to hand the batch you just
   *  uploaded straight to the captioning flow. */
  selectByIds(ids: string[]) {
    if (!ids.length) return;
    this.selectionMode.set(true);
    this.selectedIds.set(new Set(ids));
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
        from(this.photoService.deletePhoto(photo)).subscribe(() => {
          if (photo.id) this.photoService.forgetCached(photo.id);
          this.snackBar.open('Photo deleted', undefined, { duration: 2000 });
        });
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
      mine.forEach(p => p.id && this.photoService.forgetCached(p.id));
      const failed = results.filter(r => r.status === 'rejected').length;
      this.snackBar.open(
        failed ? `Deleted ${mine.length - failed}, ${failed} failed` : `Deleted ${mine.length} photos`,
        failed ? 'Dismiss' : undefined,
        { duration: failed ? 3000 : 2000 });
      this.exitSelection();
    });
  }
}
