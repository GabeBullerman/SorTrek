import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';

export interface CaptionDialogData {
  /** How many photos the caption will be written to. */
  count: number;
  /** Existing text, when editing rather than captioning a batch. */
  caption?: string;
}

/** Asks for one caption. Used for a batch from the selection pill; the lightbox
 *  edits inline instead, since there's room for it there. */
@Component({
  selector: 'app-caption-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, FormsModule],
  template: `
    <h2 mat-dialog-title>
      {{ data.count === 1 ? 'Caption photo' : 'Caption ' + data.count + ' photos' }}
    </h2>
    <mat-dialog-content>
      @if (data.count > 1) {
        <p class="hint">The same caption is written to all {{ data.count }} — handy for a day or a place.</p>
      }
      <mat-form-field appearance="outline" class="field">
        <mat-label>Caption</mat-label>
        <input matInput [(ngModel)]="text" maxlength="120" cdkFocusInitial
               (keyup.enter)="save()" placeholder="Day 3 — Kyoto" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="undefined">Cancel</button>
      <button mat-flat-button color="primary" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .field { width: 100%; min-width: 260px; }
    .hint { margin: 0 0 8px; font-size: 0.82rem; color: var(--st-on-surface-muted); }
  `],
})
export class CaptionDialogComponent {
  data = inject<CaptionDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<CaptionDialogComponent>);

  text = this.data.caption ?? '';

  save() {
    // An empty string is a legitimate result — it clears an existing caption.
    this.dialogRef.close(this.text.trim());
  }
}
