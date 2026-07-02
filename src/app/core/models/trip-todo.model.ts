import { Timestamp } from '@angular/fire/firestore';

/** A lightweight pre-trip task ("book rental car", "renew passport"). */
export interface TripTodo {
  id?: string;
  tripId: string;
  title: string;
  /** UID of the member responsible, or null for anyone. */
  assignedTo?: string | null;
  done: boolean;
  /** Optional calendar-day deadline (UTC midnight, same as trip dates). */
  dueDate?: Timestamp | null;
  createdBy: string;
  createdAt: Timestamp;
}
