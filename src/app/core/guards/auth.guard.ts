import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';

export const authGuard: CanActivateFn = async () => {
  const firebaseAuth = inject(Auth);
  const router = inject(Router);

  await firebaseAuth.authStateReady();
  if (firebaseAuth.currentUser) return true;
  router.navigate(['/auth/login']);
  return false;
};
