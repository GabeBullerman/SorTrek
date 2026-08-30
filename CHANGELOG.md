# SorTrek — Changelog

## 2026-08 — Groq model refresh

### AI
- **Every AI feature was failing.** `llama-3.3-70b-versatile` was decommissioned
  by Groq on 2026-08-16, so packing suggestions, the chat assistant, Find Plans,
  transport planning and email parsing were all calling a model that no longer
  exists.
- Moved to `qwen/qwen3.6-27b`, one of Groq's two named replacements. Both
  replacements are reasoning models, which these endpoints can't take as-is —
  a model that spends its token budget thinking returns empty or
  `<think>`-wrapped output, and the strict-JSON extraction in Find Plans and the
  email scraper then yields nothing. Qwen is the one that can be turned all the
  way off, so the helper sends `reasoning_effort: 'none'` for non-thinking mode;
  gpt-oss only goes down to `low`.
- `groqChat` takes a `reasoningEffort` option (pass `null` to omit the field for
  a model that doesn't accept it), and strips a `<think>` block from the content
  if one ever arrives anyway.

## 2026-08 — Section dropdown styling

### Navigation
- The dropdown panel now matches the trigger's width exactly — measured on open,
  since the trigger is full-bleed on phones and fixed on desktop, so it can't be
  a constant. Material's 280px panel cap is overridden.
- Each item's icon and label are centered as one group in the panel width,
  replacing Material's left-aligned layout and its 12px icon gutter.
- Items tightened from 48px to 40px, separated by a thin hairline inset to 62%
  of the width so it floats between rows instead of running edge to edge.

## 2026-08 — Trip sections as a dropdown

### Navigation
- The horizontal tab strip becomes a **dropdown** that names the section you're
  on, icon alongside the label, with every section listed in the menu the same
  way. On phones the strip showed icon-only tabs and hid six sections behind a
  "More" overflow; now nothing is hidden and the current section is stated
  rather than inferred from a highlighted icon.
- The trigger is full-width on phones and sticky, so it stays reachable while a
  long section scrolls.
- `?tab=` links still work unchanged, and the overflow bookkeeping the strip
  needed (and its scroll-into-view) is gone.

## 2026-08 — Photo album polish

### Photos
- Selection actions moved into a **floating pill** at the bottom of the screen —
  the count, Save, delete, and dismiss — instead of a bar that pushed the grid
  around when a selection started. The grid keeps clearance beneath it so the
  last row stays reachable.
- Per-tile save/delete buttons shrunk (26px, 30px on touch) so they sit on the
  image instead of dominating it.
- The album count is just the icon and the number now; "photos" was saying
  nothing the icon didn't.
- The grid and the pill share one Firestore listener rather than opening two.

## 2026-08 — Photo album: storage recovery + native saving

### Photos
- **Missing photos are recovered from Storage.** The album is a set of Firestore
  records pointing at files in the bucket, and the two drift apart — an upload
  whose tab closed before the record was written, or a record removed by the old
  auto-purge bug, leaves the image sitting in Storage with nothing pointing at
  it. `api/photo-sync` lists what the trip really has in Storage and writes back
  a record for anything the album is missing (reusing each object's existing
  download token, and recovering the original upload time from the filename so
  it sorts back into place). Runs automatically when the album opens, plus a
  **Sync** button that reports the album/storage counts.
- **Saving no longer opens a Firebase tab.** Storage download URLs are
  cross-origin, so `<a download>` is ignored and `fetch` needs bucket CORS —
  which is why every save bounced to a new tab. Photos now stream through
  `api/photo-download` on our own origin, so the browser gets a real file.
- The three photo endpoints share one function (`api/photos.js`, dispatching on
  `?action=`) — Vercel's Hobby plan caps a deployment at 12 Serverless Functions
  and `api/` was already sitting exactly on that limit.
- **Native share sheet on iOS/Android** ("Save Image" straight to the camera
  roll). The bytes are prefetched the moment a photo is selected or opened, so
  the Save tap can raise the sheet while the gesture is still live — awaiting a
  download first is what made iOS refuse it.

## 2026-08 — Photo album: multi-select, save to device, full album

### Photos
- **Hold to select** — press and hold any photo (or hit **Select**) to enter
  selection mode: tap to tick more, **Select all**, Esc or ✕ to leave.
- **Save to your device** — save the selected photos in one go, or a single
  photo from its tile or the lightbox. Uses the native share sheet on mobile
  (so "Save Image" lands in the camera roll) and a file download elsewhere,
  falling back to opening the image if Storage CORS isn't configured.
- **Delete selected** — bulk-delete the photos you uploaded; other people's
  selected photos are left untouched.
- **The whole album is shown again.** The album query ordered by `uploadedAt`,
  and Firestore drops documents that are missing the ordered field — so photos
  whose server timestamp hadn't resolved yet never appeared. Photos are now
  fetched by trip and sorted client-side.
- **No more silent self-deletion.** A photo that failed to load once had its
  Firestore document purged automatically, which permanently removed photos on
  nothing more than an expired token or a flaky connection. Failed images are
  now retried, then shown as a placeholder with **Try again**; removal is an
  explicit choice by the photo's owner.
- Deleting a photo no longer fails outright when the Storage object is already
  gone — the database record is cleaned up either way.

## 2026-06 — Rebrand, dark mode, and feature wave

### Branding
- Rebrand Wayfarer → **SorTrek** across the app (title, PWA manifest, copy,
  Angular project + build paths, package name).
- New logo set (clear-on-circle / white / black), theme-aware login & register
  logos, theme-aware favicon (light/dark), per-page browser tab titles
  (`SorTrek | <Page>`).

### Dark mode & theming
- CSS design-token system (`src/styles/_tokens.scss`) — light + dark sets.
- Material dark theme + `ThemeService` (persists choice, follows OS by default).
- Animated "Within" theme toggle (desktop toolbar; sidenav menu on mobile).
- ~190 hardcoded colors migrated to tokens + dark-mode contrast passes.

### Features
- **Timezone-aware flight times** — labels each flight time with its airport
  zone (e.g. MST/CEST) when a flight crosses zones (`TimezoneService` + a
  ~140-airport dataset). Shown in Bookings, Schedule, Overview.
- **Calendar export (.ics)** — "Add to Calendar" on Overview.
- **Search/filter** on Bookings, Costs, Documents.
- **Countdown badge** on upcoming trip cards; trips sorted soonest-first.
- **Guide** — added Overview/Map, Photos, Packing, Profile pages.
- **Packing templates** — one-tap starter lists (Beach/Ski/City/Camping/Essentials).
- **Status-colored booking borders** (confirmed/pending/cancelled/suggestion).
- **Schedule propose → approve** — collaborators propose items; owners approve/
  reject; owners grant per-collaborator "can edit schedule" in the People tab.
- **Today card** on Overview when currently on the trip.
- **Multi-currency expenses** — foreign amounts convert to the trip's home
  currency for totals; native amount still shown.
- **Booking file attachments** — boarding passes / confirmations (PDF/image).
- **Read-only public itinerary link** (`/s/<token>`) — sanitized, served by an
  Admin-SDK API (no public client reads).
- **Flight check-in reminders** — daily Vercel cron sends FCM push to trip
  members (works with the app closed).

### Fixes & quality
- Find Plans now only suggests events available on the selected day
  (date-targeted search + structured dates + server-side date filter).
- Photo reliability: purge orphaned photo docs, fix broken-image flicker,
  correct the visible count.
- Bundle: `@defer` all 10 trip-detail tabs (chunk 488 kB → 15 kB; per-tab
  on-demand loading).
- Firestore `ignoreUndefinedProperties` (prevents undefined-field save hangs).
- Storage rule: cover-photo read now requires sign-in.
- Mobile: responsive pass across the app; theme toggle in sidenav; guide
  illustrations fit (aspect-ratio); "Bookings at a Glance" reflow; map
  re-fits to pins under lazy-loaded tabs.
- Accessibility: aria-labels / alt text across high-traffic screens.

### Deploy/setup notes
- Admin-backed features (public link, push cron) need `FIREBASE_SERVICE_ACCOUNT`
  and `CRON_SECRET` in Vercel env.
- Security rules: `firebase deploy --only firestore:rules,storage`.
