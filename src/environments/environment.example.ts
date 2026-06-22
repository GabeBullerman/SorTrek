// Copy this file to environment.ts and fill in your own values for local development.
// environment.ts is gitignored — never commit real API keys.
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
  },
  googleMapsApiKey: 'YOUR_GOOGLE_MAPS_API_KEY',
  vapidKey: 'YOUR_VAPID_KEY', // Firebase → Cloud Messaging → Web Push certificates
};
