import { Timestamp } from '@angular/fire/firestore';

export type ItemCategory = 'transport' | 'accommodation' | 'activity' | 'food' | 'other';

export interface ItineraryItem {
  id?: string;
  tripId: string;
  date: Timestamp;
  startTime?: string;
  endTime?: string;
  title: string;
  description?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  category: ItemCategory;
  cost?: number;
  currency?: string;
  /** Whether `cost` is the total or a per-person amount. */
  costType?: 'total' | 'per-person';
  notes?: string;
  order: number;
  /** True while this item is awaiting owner approval — created by a member who
   *  doesn't have direct schedule-edit rights. Approved items omit this/false. */
  proposed?: boolean;
  /** UID of the member who proposed this item (for attribution + rules). */
  proposedBy?: string;
  /** Member votes on a proposed item: uid → up/down. Cleared on approval. */
  votes?: Record<string, 'up' | 'down'>;
}
