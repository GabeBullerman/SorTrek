// Firebase Cloud Messaging service worker
// Handles background push notifications when the app is closed/backgrounded.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Config is injected at runtime via postMessage from the Angular app.
// We cache it in IndexedDB so it survives SW restarts.
let messaging;

self.addEventListener('message', event => {
  if (event.data?.type === 'FIREBASE_CONFIG' && !messaging) {
    firebase.initializeApp(event.data.config);
    messaging = firebase.messaging();

    messaging.onBackgroundMessage(payload => {
      const { title, body, icon } = payload.notification ?? {};
      self.registration.showNotification(title ?? 'SorTrek', {
        body: body ?? '',
        icon: icon ?? '/ClearLogoWhiteCircle.png',
        badge: '/ClearLogoWhiteCircle.png',
        data: payload.data,
      });
    });
  }
});
