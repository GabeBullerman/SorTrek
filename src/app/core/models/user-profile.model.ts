import { Timestamp } from '@angular/fire/firestore';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  country?: string;
  homeCity?: string;
  homeCurrency: string;
  photoURL?: string;
  notificationsEnabled?: boolean;
  fcmToken?: string;
  createdAt: Timestamp;
}
