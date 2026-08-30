# Travel Organizer — Setup Guide

## Stack
- **Angular 21** (standalone components)
- **Firebase** (Firestore, Auth, Storage)
- **Angular Material 3** (UI components)
- **Google Maps API** (location map on trip overview)

---

## 1. Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → follow the wizard
3. In **Build → Authentication** → enable **Email/Password**
4. In **Build → Firestore Database** → create a database (start in test mode for dev)
5. In **Build → Storage** → enable storage (start in test mode for dev)
6. Go to **Project Settings (⚙️)** → **Your apps** → Add a **Web app**
7. Copy the Firebase config object

---

## 2. Add Your Firebase Config

Edit `src/environments/environment.ts`:

```ts
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_ACTUAL_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project-id',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123:web:abc',
  },
  googleMapsApiKey: 'YOUR_GOOGLE_MAPS_KEY',  // optional, see below
};
```

---

## 3. Google Maps API Key (Optional)

The map on the trip Overview tab requires a Google Maps API key.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Maps JavaScript API**
3. Create an API key (restrict it to your domain for production)
4. Add it to `environment.ts` → `googleMapsApiKey`

If you skip this, the map area shows a placeholder message — everything else still works.

---

## 3b. Flight Tracking API Key (Optional)

Flight bookings can pull **live status** (real-time / estimated times, delay, gate,
terminal) via the `/api/flight-status` serverless function. Configure **one** of
these provider keys as a Vercel environment variable (or in `.env.local` for local
dev with `npm run dev:api`):

| Env var | Provider | Notes |
|---|---|---|
| `AVIATIONSTACK_API_KEY` | [aviationstack.com](https://aviationstack.com) | Free tier available (HTTP only) |
| `AERODATABOX_RAPIDAPI_KEY` | [AeroDataBox on RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) | Fallback if AviationStack is unset |

If neither key is set, the **Check live status** button shows a friendly
"not set up" message and manual times still work normally. Lookups are keyed by
the flight number (e.g. `DL123`) plus the departure date you enter.

---

## 4. Firestore Security Rules

In Firebase Console → Firestore → Rules, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trips/{tripId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null;
    }
    match /bookings/{id} {
      allow read, write: if request.auth != null;
    }
    match /itinerary/{id} {
      allow read, write: if request.auth != null;
    }
    match /photos/{id} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## 5. Firebase Storage Rules

In Firebase Console → Storage → Rules:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /photos/{userId}/{tripId}/{filename} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 5b. Saving photos to a device

Saving photos runs through `/api/photo-download`, which streams the image from
our own origin — that is what lets the browser hand over a real file (and iOS
show "Save Image" / "Save to Files") instead of opening the image in a new tab.
It needs `FIREBASE_SERVICE_ACCOUNT` set, the same service-account JSON the other
API routes use.

`/api/photo-sync` uses the same credentials to reconcile a trip's album against
Storage, restoring records for images that are in the bucket but missing from
the album.

Bucket CORS is **optional** — it's only the fallback path if the API route is
unavailable. To enable it anyway, add your origins to `storage.cors.json` and:

```bash
gcloud storage buckets update gs://your-project.appspot.com --cors-file=storage.cors.json
# or, with the older tool: gsutil cors set storage.cors.json gs://your-project.appspot.com
```

---

## 6. Run the App

```bash
cd travel-organizer
npm install
npm start
# App runs at http://localhost:4200
```

---

## Features

| Feature | Description |
|---|---|
| **Auth** | Email/password login & registration |
| **Trips Dashboard** | Card grid with status badges, create/edit/delete |
| **Daily Schedule** | Timeline view grouped by day with activity categories |
| **Bookings** | Flights, hotels, Airbnbs with confirmation numbers & status |
| **Photos** | Upload via click or drag-and-drop, lightbox viewer, hold-to-select, save photos to your device |
| **Cost Tracker** | Visual bar chart + per-category itemized breakdown |
| **Map** | Google Maps with pins for all activities that have coordinates |
