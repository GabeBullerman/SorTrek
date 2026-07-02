import { Timestamp } from '@angular/fire/firestore';

export type ItemCategory = 'transport' | 'drive' | 'accommodation' | 'activity' | 'food' | 'other';

/** A planned stop along a drive (gas, food, sightseeing…). */
export interface DriveStop {
  name: string;
  kind: 'gas' | 'food' | 'sights' | 'rest' | 'other';
  /** Optional rough time ("13:30") for ordering the day. */
  time?: string;
  notes?: string;
}

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
  /** Optional source/booking URL (tour page, tickets, reservation, AI source). */
  link?: string;
  // ── Drive legs (category === 'drive') ───────────────────────────
  /** Where the drive starts, e.g. "Lisbon". */
  fromLocation?: string;
  /** Where the drive ends, e.g. "Porto". */
  toLocation?: string;
  /** Planned stops along the way. */
  stops?: DriveStop[];
  order: number;
  /** True while this item is awaiting owner approval — created by a member who
   *  doesn't have direct schedule-edit rights. Approved items omit this/false. */
  proposed?: boolean;
  /** UID of the member who proposed this item (for attribution + rules). */
  proposedBy?: string;
  /** Member votes on a proposed item: uid → up/down. Cleared on approval. */
  votes?: Record<string, 'up' | 'down'>;
}
