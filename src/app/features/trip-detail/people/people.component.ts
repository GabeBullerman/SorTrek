import { Component, Input, OnInit, OnChanges, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog } from '@angular/material/dialog';
import { Observable, from, combineLatest, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { ParticipantService } from '../../../core/services/participant.service';
import { AuthService } from '../../../core/services/auth.service';
import { TripService } from '../../../core/services/trip.service';
import { UserService } from '../../../core/services/user.service';
import { TripParticipant } from '../../../core/models/trip-participant.model';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Trip } from '../../../core/models/trip.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [
    AsyncPipe, ReactiveFormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, MatTooltipModule, MatSlideToggleModule,
  ],
  templateUrl: './people.component.html',
  styleUrl: './people.component.scss',
})
export class PeopleComponent implements OnInit, OnChanges {
  @Input() tripId!: string;
  @Input() trip?: Trip;
  @Input() isOwner = false;

  private participantService = inject(ParticipantService);
  private tripService = inject(TripService);
  private userService = inject(UserService);
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  readonly currentUserId = this.auth.currentUser?.uid ?? '';

  participants$!: Observable<TripParticipant[]>;
  /** Observable of resolved member profiles (owner first, then collaborators) */
  collaborators$!: Observable<(UserProfile & { uid: string; isOwner: boolean; isCoOwner: boolean; photoURL?: string })[]>;

  showAddForm = signal(false);
  saving = signal(false);
  editingId = signal<string | null>(null);

  // Invite collaborator form
  inviteEmail = signal('');
  inviteLoading = signal(false);

  // Invite link
  generatingLink = signal(false);
  linkCopied = signal(false);

  addForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', Validators.email],
    homeCity: [''],
  });

  editForm = this.fb.group({
    name: ['', Validators.required],
    homeCity: [''],
  });

  ngOnInit() {
    this.participants$ = this.participantService.getParticipants(this.tripId);
    this.loadCollaborators();
  }

  ngOnChanges() {
    if (this.tripId) {
      this.participants$ = this.participantService.getParticipants(this.tripId);
      this.loadCollaborators();
    }
  }

  private loadCollaborators() {
    type Member = UserProfile & { uid: string; isOwner: boolean; isCoOwner: boolean };

    const authUser = this.auth.currentUser;

    // Best-effort field resolution: Firestore profile → Firebase Auth (own card only) → fallback
    const resolve = (uid: string, profile: UserProfile | undefined) => {
      const isMe = uid === authUser?.uid;
      return {
        displayName: profile?.displayName || (isMe ? (authUser!.displayName ?? '') : '') || 'Member',
        email:       profile?.email       || (isMe ? (authUser!.email ?? '')        : ''),
        photoURL:    profile?.photoURL    || (isMe ? (authUser!.photoURL ?? '')     : '') || undefined,
      };
    };

    this.collaborators$ = this.tripService.getTrip(this.tripId).pipe(
      switchMap((trip: Trip) => {
        const ownerUid = trip?.userId;
        if (!ownerUid) return of([] as Member[]);

        const coOwnerIds = trip?.ownerIds ?? [];
        const collabIds = (trip?.collaboratorIds ?? []).filter(id => id !== ownerUid);

        const owner$ = this.userService.getProfile(ownerUid).pipe(
          map(profile => {
            const resolved = resolve(ownerUid, profile);
            return {
              uid: ownerUid,
              ...resolved,
              displayName: resolved.displayName !== 'Member' ? resolved.displayName : 'Trip Owner',
              homeCurrency: profile?.homeCurrency ?? '',
              createdAt: profile?.createdAt ?? null as any,
              isOwner: true,
              isCoOwner: false,
            } as Member;
          })
        );

        if (collabIds.length === 0) {
          return owner$.pipe(map(owner => [owner]));
        }

        const collabs$ = combineLatest(
          collabIds.map(uid =>
            this.userService.getProfile(uid).pipe(
              map(profile => ({
                uid,
                ...resolve(uid, profile),
                homeCurrency: profile?.homeCurrency ?? '',
                createdAt: profile?.createdAt ?? null as any,
                // Co-owners get the Owner badge + owner privileges.
                isOwner: coOwnerIds.includes(uid),
                isCoOwner: coOwnerIds.includes(uid),
              } as Member))
            )
          )
        );

        return combineLatest([owner$, collabs$]).pipe(
          map(([owner, collabs]) => [owner, ...collabs])
        );
      })
    );
  }

  /** Generate invite link and copy to clipboard */
  async copyInviteLink() {
    this.generatingLink.set(true);
    try {
      const token = await this.tripService.generateInviteToken(this.tripId);
      const url = `${window.location.origin}/invite/${token}`;
      await navigator.clipboard.writeText(url);
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 3000);
    } catch {
      this.snackBar.open('Could not copy link. Please try again.', undefined, { duration: 3000 });
    } finally {
      this.generatingLink.set(false);
    }
  }

  /** Send a collaborator invite */
  async sendInvite() {
    const email = this.inviteEmail().trim();
    if (!email) return;
    this.inviteLoading.set(true);
    try {
      const result = await this.tripService.inviteCollaborator(this.tripId, email);
      this.snackBar.open(result.message, undefined, { duration: 4000 });
      if (result.success) {
        this.inviteEmail.set('');
      }
    } catch {
      this.snackBar.open('Something went wrong. Please try again.', undefined, { duration: 3000 });
    } finally {
      this.inviteLoading.set(false);
    }
  }

  /** Leave this trip as a collaborator (non-owner only) */
  leaveTripAsMember() {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Leave Trip',
        message: 'Leave this trip? It will be removed from your trips list and you\'ll lose access.',
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      from(this.tripService.leaveTrip(this.tripId)).subscribe({
        next: () => {
          this.snackBar.open('You\'ve left the trip', undefined, { duration: 2500 });
          this.router.navigate(['/trips']);
        },
        error: () => this.snackBar.open('Could not leave trip. Try again.', undefined, { duration: 3000 }),
      });
    });
  }

  /** Transfer ownership to a collaborator */
  transferOwnership(uid: string, name: string) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Transfer Ownership',
        message: `Make ${name} the new owner of this trip? You'll become a collaborator and lose owner privileges.`,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      from(this.tripService.transferOwnership(this.tripId, uid)).subscribe({
        next: () => this.snackBar.open(`${name} is now the trip owner`, undefined, { duration: 3000 }),
        error: () => this.snackBar.open('Transfer failed. Please try again.', undefined, { duration: 3000 }),
      });
    });
  }

  /** Promote a collaborator to co-owner (shares full owner privileges). */
  makeCoOwner(uid: string, name: string) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Make Co-Owner',
        message: `Give ${name} co-owner privileges? They'll have the same control over this trip as you, but you remain the primary owner.`,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      from(this.tripService.addCoOwner(this.tripId, uid)).subscribe({
        next: () => this.snackBar.open(`${name} is now a co-owner`, undefined, { duration: 3000 }),
        error: () => this.snackBar.open('Could not update co-owner. Try again.', undefined, { duration: 3000 }),
      });
    });
  }

  /** Demote a co-owner back to a regular collaborator. */
  removeCoOwner(uid: string, name: string) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Remove Co-Owner',
        message: `Remove ${name}'s co-owner privileges? They'll stay on the trip as a collaborator.`,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      from(this.tripService.removeCoOwner(this.tripId, uid)).subscribe({
        next: () => this.snackBar.open(`${name} is no longer a co-owner`, undefined, { duration: 3000 }),
        error: () => this.snackBar.open('Could not update co-owner. Try again.', undefined, { duration: 3000 }),
      });
    });
  }

  /** Remove a collaborator (revokes both their UID and any invited email). */
  removeCollaborator(uid: string, name: string, email?: string) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Remove Collaborator',
        message: `Remove ${name} from this trip? They will no longer be able to view or edit it.`,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.tripService.removeCollaborator(this.tripId, uid, email)).subscribe({
          next: () => this.snackBar.open('Collaborator removed', undefined, { duration: 2500 }),
          error: () => this.snackBar.open('Could not remove them. Please try again.', undefined, { duration: 3000 }),
        });
      }
    });
  }

  openAdd() {
    this.addForm.reset({ name: '', email: '', homeCity: '' });
    this.showAddForm.set(true);
  }

  cancelAdd() {
    this.showAddForm.set(false);
  }

  saveAdd() {
    if (this.addForm.invalid) return;
    this.saving.set(true);
    const v = this.addForm.value;
    const email = v.email?.trim().toLowerCase() || undefined;

    from(this.participantService.addParticipant({
      tripId: this.tripId,
      name: v.name!.trim(),
      homeCity: v.homeCity?.trim() || undefined,
      isOrganizer: false,
      inviteEmail: email,
      inviteStatus: email ? 'pending' : undefined,
    })).subscribe({
      next: async () => {
        // Grant trip access to the invited email so they can read/write trip
        // content as soon as they log in — even before they have an account.
        if (email) {
          try { await this.tripService.addCollaboratorEmail(this.tripId, email); } catch { /* best effort */ }
        }
        this.saving.set(false);
        this.showAddForm.set(false);
        const msg = email
          ? `${v.name!.trim()} added — they'll see this trip when they log in with ${email}`
          : 'Participant added';
        this.snackBar.open(msg, undefined, { duration: 4000 });
      },
      error: () => this.saving.set(false),
    });
  }

  startEdit(p: TripParticipant) {
    this.editingId.set(p.id!);
    this.editForm.setValue({ name: p.name, homeCity: p.homeCity ?? '' });
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  saveEdit(p: TripParticipant) {
    if (this.editForm.invalid) return;
    const v = this.editForm.value;
    from(this.participantService.updateParticipant(p.id!, {
      name: v.name!.trim(),
      homeCity: v.homeCity?.trim() || undefined,
    })).subscribe({
      next: () => {
        this.editingId.set(null);
        this.snackBar.open('Updated', undefined, { duration: 2000 });
      },
    });
  }

  remove(p: TripParticipant) {
    this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Remove Participant', message: `Remove ${p.name} from this trip?` },
    }).afterClosed().subscribe(async confirmed => {
      if (!confirmed) return;
      // Revoke any granted access first so the person loses the trip immediately,
      // then delete the roster entry.
      try {
        if (p.inviteEmail) await this.tripService.removeCollaboratorEmail(this.tripId, p.inviteEmail);
        if (p.userId) await this.tripService.removeCollaborator(this.tripId, p.userId, p.inviteEmail);
      } catch { /* best effort — still remove the roster entry below */ }
      from(this.participantService.deleteParticipant(p.id!)).subscribe(() =>
        this.snackBar.open('Participant removed', undefined, { duration: 2000 })
      );
    });
  }

  leaveTrip(p: TripParticipant) {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Leave Trip',
        message: 'Leave this trip? It will be removed from your trips list.',
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        from(this.participantService.deleteParticipant(p.id!)).subscribe(() => {
          this.snackBar.open('You have left the trip', undefined, { duration: 2500 });
          this.router.navigate(['/trips']);
        });
      }
    });
  }

  /** Whether a member currently has direct schedule-edit rights. */
  canEditSchedule(uid: string): boolean {
    return (this.trip?.scheduleEditorIds ?? []).includes(uid);
  }

  /** Owner-only toggle: grant/revoke a collaborator's schedule-edit rights. */
  toggleScheduleEdit(uid: string, name: string, allow: boolean) {
    const op = allow
      ? this.tripService.grantScheduleEdit(this.tripId, uid)
      : this.tripService.revokeScheduleEdit(this.tripId, uid);
    from(op).subscribe({
      next: () => this.snackBar.open(
        allow ? `${name} can now edit the schedule` : `${name} can no longer edit the schedule`,
        undefined, { duration: 2500 }),
      error: () => this.snackBar.open('Could not update permission. Try again.', undefined, { duration: 3000 }),
    });
  }

  isMe(p: TripParticipant): boolean {
    return !!p.userId && p.userId === this.currentUserId;
  }

  initial(name: string): string {
    return name.charAt(0).toUpperCase();
  }
}
