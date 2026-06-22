import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { provideRouter, withComponentInputBinding, TitleStrategy } from '@angular/router';
import { SortrekTitleStrategy } from './core/sortrek-title.strategy';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideHttpClient, withJsonpSupport } from '@angular/common/http';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, provideFirestore } from '@angular/fire/firestore';
import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver, provideAuth } from '@angular/fire/auth';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getMessaging, provideMessaging } from '@angular/fire/messaging';
import { environment } from '../environments/environment';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: SortrekTitleStrategy },
    provideAnimationsAsync(),
    provideNativeDateAdapter(),
    provideHttpClient(withJsonpSupport()),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => initializeFirestore(getApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      // Belt-and-suspenders: silently drop `undefined` fields instead of throwing.
      // Services still call stripUndefined(), but this prevents the class of
      // "addDoc hangs/throws on an undefined field" bug app-wide.
      ignoreUndefinedProperties: true,
    })),
    provideAuth(() => initializeAuth(getApp(), {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    })),
    provideStorage(() => getStorage()),
    provideMessaging(() => getMessaging()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
