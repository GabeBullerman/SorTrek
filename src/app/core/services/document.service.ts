import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, limit,
} from '@angular/fire/firestore';
import {
  Storage, ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from '@angular/fire/storage';
import { Observable } from 'rxjs';
import { TripDocument, DocumentCategory } from '../models/trip-document.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private auth = inject(AuthService);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getDocuments(tripId: string): Observable<TripDocument[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'tripDocuments'),
        where('tripId', '==', tripId),
        orderBy('uploadedAt', 'desc'),
        limit(300)
      );
      return collectionData(q, { idField: 'id' }) as Observable<TripDocument[]>;
    });
  }

  uploadDocument(
    tripId: string,
    file: File,
    name: string,
    category: DocumentCategory,
    notes?: string,
    expiryDate?: string
  ): Observable<number> {
    const userId = this.auth.currentUser!.uid;
    const uploaderName = this.auth.currentUser?.displayName ?? 'Unknown';

    return new Observable(observer => {
      observer.next(0);

      const storagePath = `documents/${userId}/${tripId}/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        snapshot => observer.next((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
        err => observer.error(err),
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          const docData: Omit<TripDocument, 'id'> = {
            tripId,
            userId,
            uploaderName,
            name,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            url,
            storagePath,
            category,
            uploadedAt: serverTimestamp(),
          };
          if (notes) docData.notes = notes;
          if (expiryDate) docData.expiryDate = expiryDate;

          await this.run(() =>
            addDoc(collection(this.firestore, 'tripDocuments'), docData)
          );
          observer.next(100);
          observer.complete();
        }
      );
    });
  }

  updateDocument(id: string, changes: Partial<TripDocument>): Promise<void> {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'tripDocuments', id), changes as any)
    );
  }

  async deleteDocument(document: TripDocument): Promise<void> {
    await deleteObject(ref(this.storage, document.storagePath));
    return this.run(() => deleteDoc(doc(this.firestore, 'tripDocuments', document.id!)));
  }
}
