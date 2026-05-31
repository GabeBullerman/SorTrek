import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'trips', pathMatch: 'full' },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'trips',
        loadComponent: () => import('./features/trips/trips.component').then(m => m.TripsComponent),
      },
      {
        path: 'trips/:id',
        loadComponent: () =>
          import('./features/trip-detail/trip-detail.component').then(m => m.TripDetailComponent),
      },
      {
        path: 'past-trips',
        loadComponent: () =>
          import('./features/past-trips/past-trips.component').then(m => m.PastTripsComponent),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/profile/profile.component').then(m => m.ProfileComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'trips' },
];
