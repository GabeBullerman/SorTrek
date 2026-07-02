import { Component, Input, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Timestamp } from '@angular/fire/firestore';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { from, forkJoin } from 'rxjs';
import { take } from 'rxjs/operators';
import { PackingService } from '../../../core/services/packing.service';
import { AuthService } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { UserPreferencesService } from '../../../core/services/user-preferences.service';
import { ParticipantService } from '../../../core/services/participant.service';
import { AiAdvisorService, PackingSuggestion } from '../../../core/services/ai-advisor.service';
import { PackingItem, PackingCategory } from '../../../core/models/packing-item.model';
import { TripParticipant } from '../../../core/models/trip-participant.model';
import { Trip } from '../../../core/models/trip.model';

interface CategoryMeta {
  value: PackingCategory;
  label: string;
  icon: string;
  color: string;
}

interface CategoryGroup {
  meta: CategoryMeta;
  items: PackingItem[];
  packed: number;
}

@Component({
  selector: 'app-packing',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCheckboxModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressBarModule, MatTooltipModule, MatChipsModule, MatProgressSpinnerModule,
  ],
  templateUrl: './packing.component.html',
  styleUrl: './packing.component.scss',
})
export class PackingComponent implements OnInit {
  @Input() tripId!: string;
  @Input() trip!: Trip;

  private packingService = inject(PackingService);
  private auth = inject(AuthService);
  private userService = inject(UserService);
  private participantService = inject(ParticipantService);

  readonly currentUserId = this.auth.currentUser?.uid ?? '';
  private aiService = inject(AiAdvisorService);
  readonly prefs = inject(UserPreferencesService);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private snackBar = inject(MatSnackBar);

  readonly templateNames = ['Beach', 'Ski/Snow', 'City/Business', 'Camping', 'Essentials'] as const;

  readonly TEMPLATES: Record<string, string[]> = {
    'Beach': [
      'Swimsuit', 'Sunscreen', 'Sunglasses', 'Beach towel', 'Flip-flops',
      'Sun hat', 'Aloe vera', 'Beach bag', 'Reusable water bottle', 'Cover-up',
    ],
    'Ski/Snow': [
      'Ski jacket', 'Snow pants', 'Thermal base layers', 'Gloves', 'Beanie',
      'Goggles', 'Wool socks', 'Hand warmers', 'Lip balm', 'Helmet',
    ],
    'City/Business': [
      'Dress shirt', 'Blazer', 'Dress shoes', 'Belt', 'Laptop + charger',
      'Travel adapter', 'Umbrella', 'Portable battery', 'Dress trousers', 'Tie/accessories',
    ],
    'Camping': [
      'Tent', 'Sleeping bag', 'Headlamp', 'Bug spray', 'First-aid kit',
      'Hiking boots', 'Rain jacket', 'Multi-tool', 'Water filter', 'Trail snacks',
    ],
    'Essentials': [
      'Passport/ID', 'Phone charger', 'Toothbrush', 'Toothpaste', 'Deodorant',
      'Medications', 'Underwear', 'Socks', 'Travel documents', 'Reusable water bottle',
    ],
  };

  items = signal<PackingItem[]>([]);
  participants = signal<TripParticipant[]>([]);
  memberNames = signal<Record<string, string>>({});
  showAddForm = signal(false);
  editingId = signal<string | null>(null);
  saving = signal(false);
  filterPersonId = signal<string>('');
  aiSuggestions = signal<PackingSuggestion[]>([]);
  loadingAi = signal(false);
  showAiPanel = signal(false);

  readonly categories: CategoryMeta[] = [
    { value: 'documents',   label: 'Documents',   icon: 'description',     color: '#1565c0' },
    { value: 'clothing',    label: 'Clothing',     icon: 'checkroom',       color: '#6a1b9a' },
    { value: 'electronics', label: 'Electronics',  icon: 'devices',         color: '#0277bd' },
    { value: 'toiletries',  label: 'Toiletries',   icon: 'soap',            color: '#00695c' },
    { value: 'medicine',    label: 'Medicine',     icon: 'medication',      color: '#c62828' },
    { value: 'gear',        label: 'Gear',         icon: 'backpack',        color: '#2e7d32' },
    { value: 'food',        label: 'Food & Snacks',icon: 'lunch_dining',    color: '#e65100' },
    { value: 'other',       label: 'Other',        icon: 'more_horiz',      color: '#455a64' },
  ];

  addForm = this.fb.group({
    name:       ['', [Validators.required]],
    category:   ['other' as PackingCategory, [Validators.required]],
    quantity:   [1, [Validators.required, Validators.min(1)]],
    assignedTo: [null as string | null],
    personal:   [false],
  });

  editForm = this.fb.group({
    name:       ['', [Validators.required]],
    category:   ['other' as PackingCategory, [Validators.required]],
    quantity:   [1, [Validators.required, Validators.min(1)]],
    assignedTo: [null as string | null],
  });

  readonly filteredItems = computed(() => {
    const id = this.filterPersonId();
    const uid = this.currentUserId;
    return this.items()
      .filter(i => i.visibility !== 'personal' || (i.createdBy ?? '') === uid)
      .filter(i => !id || !i.assignedTo || i.assignedTo === id);
  });

  packedByMe(item: PackingItem): boolean {
    return (item.packedBy ?? []).includes(this.currentUserId);
  }

  packedByNames(item: PackingItem): string[] {
    const names = this.memberNames();
    return (item.packedBy ?? []).map(uid =>
      uid === this.currentUserId ? 'You' : (names[uid] ?? 'Member')
    );
  }

  readonly groups = computed((): CategoryGroup[] => {
    const items = this.filteredItems();
    const uid = this.currentUserId;
    return this.categories
      .map(meta => {
        const catItems = items.filter(i => i.category === meta.value);
        return { meta, items: catItems, packed: catItems.filter(i => (i.packedBy ?? []).includes(uid)).length };
      })
      .filter(g => g.items.length > 0);
  });

  readonly totalItems = computed(() => this.filteredItems().length);
  readonly totalPacked = computed(() => {
    const uid = this.currentUserId;
    return this.filteredItems().filter(i => (i.packedBy ?? []).includes(uid)).length;
  });
  readonly progressPct = computed(() =>
    this.totalItems() > 0 ? Math.round((this.totalPacked() / this.totalItems()) * 100) : 0
  );

  ngOnInit() {
    this.packingService.getItems(this.tripId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(items => this.items.set(items));
    this.participantService.getParticipants(this.tripId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(p => this.participants.set(p));

    // Load display names for all trip members so packedBy UIDs can be shown as names
    const allUids = [...new Set([this.trip.userId, ...(this.trip.collaboratorIds ?? [])])];
    if (allUids.length) {
      forkJoin(allUids.map(uid => this.userService.getProfile(uid).pipe(take(1))))
        .subscribe(profiles => {
          const map: Record<string, string> = {};
          allUids.forEach((uid, i) => {
            map[uid] = profiles[i]?.displayName
              || (uid === this.currentUserId ? (this.auth.currentUser?.displayName ?? 'You') : 'Member');
          });
          this.memberNames.set(map);
        });
    }
  }

  togglePacked(item: PackingItem) {
    const uid = this.currentUserId;
    const alreadyPacked = (item.packedBy ?? []).includes(uid);
    // Optimistic update so counts and styling reflect immediately
    this.items.update(list =>
      list.map(i => i.id === item.id ? {
        ...i,
        packedBy: alreadyPacked
          ? (i.packedBy ?? []).filter(id => id !== uid)
          : [...(i.packedBy ?? []), uid],
      } : i)
    );
    from(this.packingService.togglePacked(item.id!, uid, alreadyPacked)).subscribe({
      error: () => {
        // Roll back the optimistic toggle and let the user know.
        this.items.update(list =>
          list.map(i => i.id === item.id ? {
            ...i,
            packedBy: alreadyPacked
              ? [...(i.packedBy ?? []), uid]
              : (i.packedBy ?? []).filter(id => id !== uid),
          } : i)
        );
        this.snackBar.open('Could not save that change. Please try again.', undefined, { duration: 3000 });
      },
    });
  }

  deleteItem(item: PackingItem) {
    from(this.packingService.deleteItem(item.id!)).subscribe({
      error: () => this.snackBar.open('Could not remove the item. Please try again.', undefined, { duration: 3000 }),
    });
  }

  startEdit(item: PackingItem) {
    this.editingId.set(item.id!);
    this.editForm.setValue({
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      assignedTo: item.assignedTo ?? null,
    });
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  saveEdit(item: PackingItem) {
    if (this.editForm.invalid) return;
    const v = this.editForm.getRawValue();
    const changes = {
      name: v.name!.trim(),
      category: v.category! as PackingCategory,
      quantity: v.quantity!,
      assignedTo: v.assignedTo ?? null,
    };
    // Optimistic update so the row reflects the change immediately
    this.items.update(list => list.map(i => i.id === item.id ? { ...i, ...changes } : i));
    this.editingId.set(null);
    from(this.packingService.updateItem(item.id!, changes)).subscribe({
      error: () => this.snackBar.open('Could not save changes', undefined, { duration: 3000 }),
    });
  }

  saveAdd() {
    if (this.addForm.invalid) return;
    this.saving.set(true);
    const v = this.addForm.getRawValue();
    from(this.packingService.createItem({
      tripId: this.tripId,
      name: v.name!,
      category: v.category! as PackingCategory,
      quantity: v.quantity!,
      assignedTo: v.assignedTo ?? null,
      packedBy: [],
      visibility: v.personal ? 'personal' : 'everyone',
      createdBy: this.currentUserId,
    })).subscribe({
      next: () => {
        this.saving.set(false);
        this.addForm.reset({ name: '', category: 'other', quantity: 1, assignedTo: null, personal: false });
        this.showAddForm.set(false);
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Could not add the item. Please try again.', undefined, { duration: 3000 });
      },
    });
  }

  applyTemplate(name: string) {
    const names = this.TEMPLATES[name];
    if (!names) return;

    const existing = new Set(this.items().map(i => i.name.trim().toLowerCase()));
    const toAdd = names.filter(n => !existing.has(n.trim().toLowerCase()));

    if (toAdd.length === 0) {
      this.snackBar.open(`All ${name} template items are already in your list`, undefined, { duration: 2500 });
      return;
    }

    // Optimistic update so items appear immediately
    const optimistic: PackingItem[] = toAdd.map((n, i) => ({
      id: `__temp_${Date.now()}_${i}`,
      tripId: this.tripId,
      name: n,
      category: 'other' as PackingCategory,
      quantity: 1,
      assignedTo: null,
      packedBy: [],
      visibility: 'everyone' as const,
      createdBy: this.currentUserId,
      createdAt: Timestamp.now(),
    }));
    this.items.update(list => [...list, ...optimistic]);

    // Persist; real-time listener replaces temp IDs with real ones
    toAdd.forEach(n =>
      from(this.packingService.createItem({
        tripId: this.tripId,
        name: n,
        category: 'other',
        quantity: 1,
        assignedTo: null,
        packedBy: [],
        visibility: 'everyone',
        createdBy: this.currentUserId,
      })).subscribe()
    );

    this.snackBar.open(`Added ${toAdd.length} items from the ${name} template`, undefined, { duration: 2500 });
  }

  cancelAdd() {
    this.addForm.reset({ name: '', category: 'other', quantity: 1, assignedTo: null, personal: false });
    this.showAddForm.set(false);
  }

  get selectedSuggestionsCount(): number {
    return this.aiSuggestions().filter(s => s.selected).length;
  }

  fetchAiSuggestions() {
    if (this.loadingAi()) return;
    this.loadingAi.set(true);
    this.showAiPanel.set(true);
    const existing = this.items().map(i => i.name);
    this.aiService.getPackingSuggestions(this.trip, existing).subscribe(suggestions => {
      this.aiSuggestions.set(suggestions);
      this.loadingAi.set(false);
    });
  }

  toggleSuggestion(index: number) {
    this.aiSuggestions.update(list =>
      list.map((s, i) => i === index ? { ...s, selected: !s.selected } : s)
    );
  }

  addSelectedSuggestions() {
    const selected = this.aiSuggestions().filter(s => s.selected);

    // Optimistic update — items appear immediately without waiting for Firestore
    const optimistic: PackingItem[] = selected.map((s, i) => ({
      id: `__temp_${Date.now()}_${i}`,
      tripId: this.tripId,
      name: s.name,
      category: s.category,
      quantity: s.quantity,
      assignedTo: null,
      packedBy: [],
      visibility: 'everyone' as const,
      createdBy: this.currentUserId,
      createdAt: Timestamp.now(),
    }));
    this.items.update(list => [...list, ...optimistic]);

    // Persist to Firestore in background; real-time listener replaces temp IDs with real ones
    selected.forEach(s =>
      from(this.packingService.createItem({
        tripId: this.tripId,
        name: s.name,
        category: s.category,
        quantity: s.quantity,
        assignedTo: null,
        packedBy: [],
        visibility: 'everyone',
        createdBy: this.currentUserId,
      })).subscribe()
    );

    this.showAiPanel.set(false);
    this.aiSuggestions.set([]);
  }

  participantName(id: string | null | undefined): string {
    if (!id) return 'Everyone';
    return this.participants().find(p => p.id === id)?.name ?? 'Unknown';
  }

  categoryMeta(value: PackingCategory): CategoryMeta {
    return this.categories.find(c => c.value === value)!;
  }
}
