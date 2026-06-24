# SorTrek

A collaborative trip-planning web app. Plan a trip, invite the people coming
with you, and manage the whole thing together — schedule, bookings, transport,
costs, a shared photo album, and a packing list — with live updates across
everyone's devices.

Built with Angular 21 (standalone components + signals) and Firebase
(Auth, Firestore, Storage, Cloud Messaging). AI and third-party integrations
run as serverless functions under `api/` on Vercel.

## Features

- **Trips & collaboration** — invite by email or shareable link; owner/collaborator
  roles with ownership transfer; per-collaborator "can edit schedule" grants.
- **Schedule** — day-by-day itinerary with propose → approve flow for collaborators.
- **Bookings** — flights (connecting legs, per-passenger tickets, live flight
  status, timezone-aware times), hotels, cars, restaurants; file attachments
  (boarding passes / confirmations); status-colored borders.
- **Transport** — intercity train search (Deutsche Bahn) + AI transport plans.
- **Costs** — multi-currency expenses converted to the trip's home currency;
  points redeemed; Plaid transaction import.
- **Photos** — shared album, real-time across members.
- **Packing** — per-user packed state, personal vs shared items, one-tap
  templates, and AI suggestions.
- **AI** — packing/itinerary suggestions and a travel chat assistant (Groq +
  Tavily live search); booking import by scanning Gmail.
- **Public itinerary** — read-only share link (`/s/<token>`), served by an
  Admin-SDK API (no public client reads).
- **Notifications** — flight check-in reminders via a daily push cron.
- **Dark mode** — CSS design-token theming that follows the OS by default.

See [CHANGELOG.md](CHANGELOG.md) for the detailed history.

## Development

```bash
npm install
npm run dev        # ng serve with API proxy (proxy.conf.json)
npm run dev:api    # local API server for the api/ functions
```

App runs at `http://localhost:4200/`. The `dev` script proxies `/api/*` to the
local API server so the serverless functions work in development.

## Building

```bash
npm run build      # production build into dist/
npm run build:ci   # injects env (scripts/set-env.js) then builds — used by Vercel
```

## Environment

Set these in Vercel (and locally for the API server as needed):

| Variable | Used for |
| --- | --- |
| `GROQ_API_KEY` | AI features (packing, chat, transport, itinerary, email parsing) |
| `TAVILY_API_KEY` | Live web search for Find Plans |
| `FIREBASE_SERVICE_ACCOUNT` | Admin-SDK routes (public itinerary, push cron) |
| `CRON_SECRET` | Authenticates the flight-reminder cron |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Plaid expense import |
| `AVIATIONSTACK_API_KEY` / `AERODATABOX_RAPIDAPI_KEY` | Live flight status |

> Note: the `api/` functions call Groq via its OpenAI-compatible REST endpoint
> through `api/_groq.js` (the `groq-sdk` client throws "Connection error" in the
> Vercel runtime). Don't reintroduce `require('groq-sdk')` server-side.

## Deploy

Pushing to `master` deploys via Vercel. Firebase rules and indexes deploy
separately:

```bash
firebase deploy --only firestore:rules,storage
firebase deploy --only firestore:indexes
```

## Project structure

- `src/app/features/` — `trips`, `trip-detail` (tabbed: overview, schedule,
  transport, photos, costs, bookings, people, packing, documents, ai),
  `auth`, `invite`, `profile`, `past-trips`, `public-itinerary`.
- `src/app/core/` — services (Firestore-backed) and models.
- `src/styles/_tokens.scss` — light/dark design tokens.
- `api/` — Vercel serverless functions (`_`-prefixed files are shared helpers,
  not routes); `api/cron/` holds scheduled jobs (see `vercel.json`).
