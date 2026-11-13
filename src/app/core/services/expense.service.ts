import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, limit,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Expense } from '../models/expense.model';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getExpenses(tripId: string): Observable<Expense[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'expenses'),
        where('tripId', '==', tripId),
        orderBy('createdAt', 'desc'),
        limit(500)
      );
      return collectionData(q, { idField: 'id' }) as Observable<Expense[]>;
    });
  }

  createExpense(expense: Omit<Expense, 'id' | 'createdAt'>) {
    return this.run(() =>
      addDoc(collection(this.firestore, 'expenses'), {
        ...stripUndefined(expense),
        createdAt: serverTimestamp(),
      })
    );
  }

  updateExpense(id: string, changes: Partial<Expense>) {
    return this.run(() =>
      updateDoc(doc(this.firestore, 'expenses', id), stripUndefined(changes))
    );
  }

  deleteExpense(id: string) {
    return this.run(() => deleteDoc(doc(this.firestore, 'expenses', id)));
  }
}

/** Drop undefined keys — Firestore's addDoc throws synchronously on them. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
