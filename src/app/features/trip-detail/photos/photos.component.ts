import { Component, Input, OnInit, inject, signal, ElementRef, ViewChild } from '@angular/core';
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
import { catchError, tap } from 'rxjs/operators';

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

  /** IDs of photos whose <img> failed to load this session. Used to
   *  unconditionally hide their tiles in the template so Firestore
   *  cache re-emissions (which can briefly re-include the doc before
   *  the delete propagates) can't flash the broken image back in. */
  private failedIds = signal<ReadonlySet<string>>(new Set());

  isFailed(id?: string): boolean {
    return !!id && this.failedIds().has(id);
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

  openLightbox(photo: Photo) {
    this.lightboxPhoto.set(photo);
  }

  closeLightbox() {
    this.lightboxPhoto.set(null);
  }

  /** Image failed to load — the underlying Storage object is missing.
   *  Mark the ID as failed (template hides it via @if) and purge the
   *  orphan Firestore doc so the photo is gone for everyone next query. */
  onImageLoadError(photo: Photo) {
    if (!photo.id) return;
    if (this.failedIds().has(photo.id)) return;
    const next = new Set(this.failedIds());
    next.add(photo.id);
    this.failedIds.set(next);
    this.photoService.purgeOrphanDoc(photo.id);
  }

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
}
