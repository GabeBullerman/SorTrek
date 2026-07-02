import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, doc,
  addDoc, updateDoc, deleteDoc, query, where, serverTimestamp,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { TripTodo } from '../models/trip-todo.model';

@Injectable({ providedIn: 'root' })
export class TodoService {
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  getTodos(tripId: string): Observable<TripTodo[]> {
    return this.run(() => {
      const q = query(
        collection(this.firestore, 'tripTodos'),
        where('tripId', '==', tripId)
      );
      return collectionData(q, { idField: 'id' }) as Observable<TripTodo[]>;
    });
  }

  createTodo(todo: Omit<TripTodo, 'id' | 'createdAt'>) {
    return this.run(() =>
      addDoc(collection(this.firestore, 'tripTodos'), {
        ...todo,
        assignedTo: todo.assignedTo ?? null,
        dueDate: todo.dueDate ?? null,
        createdAt: serverTimestamp(),
      })
    );
  }

  setDone(id: string, done: boolean) {
    return this.run(() => updateDoc(doc(this.firestore, 'tripTodos', id), { done }));
  }

  deleteTodo(id: string) {
    return this.run(() => deleteDoc(doc(this.firestore, 'tripTodos', id)));
  }
}
