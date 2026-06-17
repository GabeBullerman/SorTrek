import { Timestamp } from '@angular/fire/firestore';

export interface Trip {
  id?: string;
  userId: string;
  name: string;
  destination: string;
  description?: string;
  startDate: Timestamp;
  endDate: Timestamp;
  coverPhotoUrl?: string;
  totalCost?: number;
  currency: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  collaboratorIds?: string[];
  inviteToken?: string;
}
