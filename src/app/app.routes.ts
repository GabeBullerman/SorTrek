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
        title: 'Trips',
        loadComponent: () => import('./features/trips/trips.component').then(m => m.TripsComponent),
      },
      {
        path: 'trips/:id',
        loadComponent: () =>
          import('./features/trip-detail/trip-detail.component').then(m => m.TripDetailComponent),
      },
      {
        path: 'past-trips',
        title: 'Past Trips',
        loadComponent: () =>
          import('./features/past-trips/past-trips.component').then(m => m.PastTripsComponent),
      },
      {
        path: 'profile',
        title: 'Profile',
        loadComponent: () =>
          import('./features/profile/profile.component').then(m => m.ProfileComponent),
      },
    ],
  },
  {
    path: 'invite/:token',
    title: 'Invite',
    loadComponent: () => import('./features/invite/invite.component').then(m => m.InviteComponent),
  },
  {
    path: 's/:token',
    title: 'Shared itinerary',
    loadComponent: () =>
      import('./features/public-itinerary/public-itinerary.component').then(m => m.PublicItineraryComponent),
  },
  {
    path: 'privacy',
    title: 'Privacy Policy',
    data: { page: 'privacy' },
    loadComponent: () => import('./features/legal/legal.component').then(m => m.LegalComponent),
  },
  {
    path: 'terms',
    title: 'Terms of Use',
    data: { page: 'terms' },
    loadComponent: () => import('./features/legal/legal.component').then(m => m.LegalComponent),
  },
  { path: '**', redirectTo: 'trips' },
];
