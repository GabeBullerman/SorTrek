import {
  Component, Input, OnInit, inject, signal, ElementRef, ViewChild,
} from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { Observable, of, from } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DocumentService } from '../../../core/services/document.service';
import { AuthService } from '../../../core/services/auth.service';
import { TripDocument, DocumentCategory } from '../../../core/models/trip-document.model';
import { Trip } from '../../../core/models/trip.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

const EXPIRY_CATEGORIES: DocumentCategory[] = ['passport', 'visa', 'insurance'];

@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [
    AsyncPipe, DatePipe, DecimalPipe, FormsModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatProgressSpinnerModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatTooltipModule, MatChipsModule,
  ],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.scss',
})
export class DocumentsComponent implements OnInit {
  @Input() tripId!: string;
  @Input() trip!: Trip;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private documentService = inject(DocumentService);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  readonly currentUserId = this.auth.currentUser?.uid ?? '';

  documents$!: Observable<TripDocument[]>;

  /** Client-side search term for filtering the document list. */
  searchTerm = signal('');

  // Upload state
  uploadProgress = signal<number | null>(null);
  uploadingName = signal('');
  showUploadForm = signal(false);

  // Form state
  pendingFile = signal<File | null>(null);
  documentName = signal('');
  selectedCategory = signal<DocumentCategory>('other');
  documentNotes = signal('');
  documentExpiry = signal('');

  readonly categories: { value: DocumentCategory; label: string }[] = [
    { value: 'passport',             label: 'Passport' },
    { value: 'visa',                 label: 'Visa' },
    { value: 'insurance',            label: 'Insurance' },
    { value: 'vaccination',          label: 'Vaccination' },
    { value: 'hotel-confirmation',   label: 'Hotel Confirmation' },
    { value: 'flight-confirmation',  label: 'Flight Confirmation' },
    { value: 'other',                label: 'Other' },
  ];

  ngOnInit() {
    this.documents$ = this.documentService.getDocuments(this.tripId).pipe(
      catchError(() => of([]))
    );
  }

  triggerUpload() {
    this.fileInput.nativeElement.click();
  }

  onFilesSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.prepareUpload(file);
    (event.target as HTMLInputElement).value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.prepareUpload(file);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  private prepareUpload(file: File) {
    this.pendingFile.set(file);
    this.documentName.set(file.name.replace(/\.[^.]+$/, ''));
    this.selectedCategory.set('other');
    this.documentNotes.set('');
    this.documentExpiry.set('');
    this.showUploadForm.set(true);
  }

  cancelUpload() {
    this.pendingFile.set(null);
    this.showUploadForm.set(false);
  }

  confirmUpload() {
    const file = this.pendingFile();
    if (!file) return;

    const name = this.documentName().trim() || file.name;
    const category = this.selectedCategory();
    const notes = this.documentNotes().trim() || undefined;
    const expiry = this.documentExpiry().trim() || undefined;

    this.showUploadForm.set(false);
    this.uploadProgress.set(0);
    this.uploadingName.set(name);

    this.documentService.uploadDocument(
      this.tripId, file, name, category, notes, expiry
    ).subscribe({
      next: progress => this.uploadProgress.set(progress),
      complete: () => {
        this.uploadProgress.set(null);
        this.uploadingName.set('');
        this.pendingFile.set(null);
        this.snackBar.open('Document uploaded!', undefined, { duration: 2000 });
      },
      error: () => {
        this.uploadProgress.set(null);
        this.uploadingName.set('');
        this.pendingFile.set(null);
        this.snackBar.open('Upload failed', 'Dismiss', { duration: 3000 });
      },
    });
  }

  showExpiryField(): boolean {
    return EXPIRY_CATEGORIES.includes(this.selectedCategory());
  }

  isExpiryWarning(doc: TripDocument): boolean {
    if (!doc.expiryDate) return false;
    const expiry = new Date(doc.expiryDate);
    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 90;
  }

  isExpired(doc: TripDocument): boolean {
    if (!doc.expiryDate) return false;
    return new Date(doc.expiryDate) < new Date();
  }

  fileIcon(fileType: string): string {
    if (fileType === 'application/pdf') return 'picture_as_pdf';
    if (fileType.startsWith('image/')) return 'image';
    if (fileType.includes('word') || fileType.includes('document')) return 'description';
    return 'attach_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  categoryLabel(cat: DocumentCategory): string {
    return this.categories.find(c => c.value === cat)?.label ?? cat;
  }

  categoryIcon(cat: DocumentCategory): string {
    switch (cat) {
      case 'passport':            return 'badge';
      case 'visa':                return 'approval';
      case 'insurance':           return 'health_and_safety';
      case 'vaccination':         return 'vaccines';
      case 'hotel-confirmation':  return 'hotel';
      case 'flight-confirmation': return 'flight';
      default:                    return 'folder_open';
    }
  }

  /** Filter documents by the current search term, matching name, category
   *  label, and file type. Empty term returns all documents. */
  filterDocs(docs: TripDocument[]): TripDocument[] {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return docs;
    return docs.filter(d => {
      const fields = [
        d.name,
        this.categoryLabel(d.category),
        d.fileType,
      ];
      return fields.some(f => f?.toLowerCase().includes(term));
    });
  }

  groupedDocs(docs: TripDocument[]): { category: DocumentCategory; label: string; docs: TripDocument[] }[] {
    const order: DocumentCategory[] = [
      'passport', 'visa', 'insurance', 'vaccination',
      'flight-confirmation', 'hotel-confirmation', 'other',
    ];
    return order
      .map(cat => ({
        category: cat,
        label: this.categoryLabel(cat),
        docs: docs.filter(d => d.category === cat),
      }))
      .filter(g => g.docs.length > 0);
  }

  deleteDocument(doc: TripDocument) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Delete Document', message: `Delete "${doc.name}"? This cannot be undone.` },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.documentService.deleteDocument(doc)).subscribe({
          next: () => this.snackBar.open('Document deleted', undefined, { duration: 2000 }),
          error: () => this.snackBar.open('Delete failed', 'Dismiss', { duration: 3000 }),
        });
      }
    });
  }

  downloadDocument(doc: TripDocument) {
    const a = window.document.createElement('a');
    a.href = doc.url;
    a.download = doc.fileName;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
}
