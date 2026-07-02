import { Timestamp } from '@angular/fire/firestore';

/**
 * A shared inspiration link (Pinterest pin, TikTok/Instagram reel, article…)
 * on a trip's Ideas board. Preview fields are fetched once when the idea is
 * added and cached here, so the board renders instantly and offline.
 */
export interface TripIdea {
  id?: string;
  tripId: string;
  url: string;
  /** The member's own note: "this beach looks amazing for day 3". */
  note?: string;
  // ── Cached link preview ─────────────────────────────
  title?: string;
  description?: string;
  /** og:image / oEmbed thumbnail URL. */
  image?: string;
  /** e.g. "TikTok", "Pinterest", "YouTube" or the hostname. */
  siteName?: string;
  createdBy: string;
  creatorName: string;
  createdAt: Timestamp;
}
