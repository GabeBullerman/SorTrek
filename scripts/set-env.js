// Runs during Vercel build (before ng build) to generate environment.prod.ts
// from Vercel environment variables. Set these in your Vercel project settings:
//   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
//   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID,
//   GOOGLE_MAPS_API_KEY, FIREBASE_VAPID_KEY (optional, for push notifications)
const fs = require('fs');
const path = require('path');

const required = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const content = `export const environment = {
  production: true,
  firebase: {
    apiKey: '${process.env.FIREBASE_API_KEY}',
    authDomain: '${process.env.FIREBASE_AUTH_DOMAIN}',
    projectId: '${process.env.FIREBASE_PROJECT_ID}',
    storageBucket: '${process.env.FIREBASE_STORAGE_BUCKET}',
    messagingSenderId: '${process.env.FIREBASE_MESSAGING_SENDER_ID}',
    appId: '${process.env.FIREBASE_APP_ID}',
  },
  googleMapsApiKey: '${process.env.GOOGLE_MAPS_API_KEY || ''}',
  vapidKey: '${process.env.FIREBASE_VAPID_KEY || ''}',
};
`;

const envDir = path.join(__dirname, '../src/environments');
// Write both files — Angular's fileReplacement needs environment.ts to exist
// as the source even in a production build, and environment.prod.ts is the replacement.
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), content);
fs.writeFileSync(path.join(envDir, 'environment.ts'), content);
console.log('environment.ts and environment.prod.ts generated from environment variables.');
