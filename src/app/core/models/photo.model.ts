import { Timestamp } from '@angular/fire/firestore';

/** The album holds photos and videos; `Photo` covers both. Older documents
 *  predate `mediaType` and are all images, so absent means image. */
export type MediaType = 'image' | 'video';

export interface Photo {
  id?: string;
  tripId: string;
  userId: string;
  uploaderName?: string;
  url: string;
  storagePath: string;
  /** 'video' for clips; absent or 'image' for pictures. */
  mediaType?: MediaType;
  /** The uploaded file's MIME type, e.g. "video/quicktime". */
  contentType?: string;
  caption?: string;
  dateTaken?: Timestamp;
  location?: string;
  uploadedAt: Timestamp;
}
