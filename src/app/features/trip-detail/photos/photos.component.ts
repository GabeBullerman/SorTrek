import { Component, HostListener, Input, OnDestroy, OnInit, inject, signal, computed, ElementRef, ViewChild } from '@angular/core';
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
/** Past this much horizontal travel the drag commits to changing photo. Also
 *  used as a fraction of the viewport, whichever is smaller, so it scales. */
const SWIPE_THRESHOLD_PX = 60;
/** Movement is assigned to an axis once it passes this; a gesture locked to
 *  vertical is left alone so it never fights a scroll. */
const AXIS_LOCK_PX = 8;
/** Resistance applied when dragging past the first or last photo. */
const RUBBER_BAND = 0.3;
/** A flick faster than this (px/ms) changes photo regardless of distance. */
const FLICK_VELOCITY = 0.5;
/** Only show a spinner if the image is genuinely slow; a cached one appears
 *  immediately and a spinner flash would look worse than nothing. */
const SPINNER_DELAY_MS = 180;

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
export class PhotosComponent implements OnInit, OnDestroy {
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

  /** Whether the open photo has decoded. Drives a fade-in, and a spinner that
   *  only appears if the load is actually slow. */
  imageReady = signal(false);
  showSpinner = signal(false);
  private spinnerTimer: ReturnType<typeof setTimeout> | null = null;

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
    // Begin decoding the full-size image now rather than when the tap lands —
    // opening the viewer felt like a reload because the decode started late.
    this.warmFullImage(photo);
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

  /** Decode a photo ahead of time; harmless to call repeatedly. */
  private warmFullImage(photo: Photo) {
    if (!photo.url || this.warmed.has(photo.url)) return;
    this.warmed.add(photo.url);
    const img = new Image();
    img.src = photo.url;
    img.decode?.().catch(() => { /* decode is a hint, not a requirement */ });
  }
  private warmed = new Set<string>();

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
    this.lockPageScroll(true);
    this.onLightboxPhotoChanged();
  }

  closeLightbox() {
    this.lightboxId.set(null);
    this.lockPageScroll(false);
    this.clearSpinnerTimer();
    this.dragX.set(0);
    this.cancelCaptionEdit();
  }

  ngOnDestroy() {
    // Leaving the tab while the viewer is open must not strand the lock.
    this.lockPageScroll(false);
    this.clearSpinnerTimer();
  }

  /** The viewer covers the page, so the page behind it shouldn't scroll —
   *  that scrolling was leaking through vertical drags on the photo. */
  private lockPageScroll(locked: boolean) {
    document.body.classList.toggle('photo-viewer-open', locked);
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
    this.beginImageLoad();
    if (photo) this.photoService.prefetch(photo);

    const i = this.lightboxIndex();
    if (i === null) return;
    for (const neighbour of [this.album()[i - 1], this.album()[i + 1]]) {
      if (neighbour) this.warmFullImage(neighbour);
    }
  }

  /* ── Swipe between photos ────────────────────────────────────────────────── */

  /** Live horizontal offset of the stage, in px — the photo follows the finger
   *  rather than jumping on release, which is what made this feel laggy. */
  dragX = signal(0);
  /** True while the stage should animate; false while a finger is down, so the
   *  drag tracks 1:1 instead of easing behind it. */
  animating = signal(false);

  private gesture: {
    x: number; y: number; t: number;
    axis: 'undecided' | 'x' | 'y';
    pointerId: number;
  } | null = null;

  /** Set when a drag actually moved, so the click that follows it doesn't also
   *  count as a tap on the backdrop and close the viewer. */
  private movedDuringGesture = false;

  onLightboxPointerDown(event: PointerEvent) {
    // Leave controls alone, and ignore secondary pointers (pinch to zoom).
    if ((event.target as HTMLElement | null)?.closest('button, input')) return;
    if (this.gesture) return;

    this.gesture = {
      x: event.clientX, y: event.clientY, t: event.timeStamp,
      axis: 'undecided', pointerId: event.pointerId,
    };
    this.movedDuringGesture = false;
    this.animating.set(false);
    (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  onLightboxPointerMove(event: PointerEvent) {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;

    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;

    // Decide once which way this gesture is going, then stick to it — a
    // wobbling finger shouldn't flip between panning and swiping.
    if (g.axis === 'undecided') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (g.axis !== 'x') return;

    this.movedDuringGesture = true;
    // Resist at the ends so it's obvious there's nothing further that way.
    const atEnd = (dx > 0 && !this.hasPrev()) || (dx < 0 && !this.hasNext());
    this.dragX.set(atEnd ? dx * RUBBER_BAND : dx);
  }

  onLightboxPointerUp(event: PointerEvent) {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.axis !== 'x') { this.dragX.set(0); return; }

    const dx = event.clientX - g.x;
    const dt = Math.max(1, event.timeStamp - g.t);
    const velocity = Math.abs(dx) / dt;

    // Commit on either a long enough drag or a quick flick.
    const threshold = Math.min(SWIPE_THRESHOLD_PX, window.innerWidth * 0.18);
    const committed = Math.abs(dx) > threshold || velocity > FLICK_VELOCITY;
    const direction = dx < 0 ? 1 : -1;
    const canMove = direction === 1 ? this.hasNext() : this.hasPrev();

    if (committed && canMove) {
      this.slideTo(direction);
    } else {
      this.animating.set(true);
      this.dragX.set(0);
    }
  }

  onLightboxPointerCancel() {
    this.gesture = null;
    this.animating.set(true);
    this.dragX.set(0);
  }

  /** Swap in the neighbouring photo and slide it in from the edge the finger
   *  was heading towards, so the change reads as one continuous movement. */
  private slideTo(direction: 1 | -1) {
    this.showRelative(direction);
    this.animating.set(false);
    this.dragX.set(direction * window.innerWidth);
    requestAnimationFrame(() => {
      this.animating.set(true);
      this.dragX.set(0);
    });
  }

  /** The backdrop closes on a tap, but not at the end of a drag. */
  onLightboxBackdropClick() {
    if (this.movedDuringGesture) { this.movedDuringGesture = false; return; }
    this.closeLightbox();
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeft() {
    if (this.lightboxIndex() !== null && !this.editingCaption()) this.showRelative(-1);
  }

  @HostListener('document:keydown.arrowright')
  onArrowRight() {
    if (this.lightboxIndex() !== null && !this.editingCaption()) this.showRelative(1);
  }

  /* ── Image load state ────────────────────────────────────────────────────── */

  private beginImageLoad() {
    this.imageReady.set(false);
    this.clearSpinnerTimer();
    // A cached photo paints within a frame or two; showing a spinner for that
    // is worse than showing nothing, so it waits before appearing.
    this.spinnerTimer = setTimeout(() => this.showSpinner.set(true), SPINNER_DELAY_MS);
  }

  onLightboxImageLoad() {
    this.imageReady.set(true);
    this.clearSpinnerTimer();
  }

  private clearSpinnerTimer() {
    if (this.spinnerTimer) clearTimeout(this.spinnerTimer);
    this.spinnerTimer = null;
    this.showSpinner.set(false);
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
