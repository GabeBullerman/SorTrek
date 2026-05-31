import { Timestamp } from '@angular/fire/firestore';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  country?: string;
  homeCity?: string;
  homeCurrency: string;
  notificationsEnabled?: boolean;
  fcmToken?: string;
  createdAt: Timestamp;
}
