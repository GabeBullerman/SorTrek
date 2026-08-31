# SorTrek — Changelog

## 2026-08 — Layovers on the flight itself

### Bookings
- A **stops badge** sits beside the flight's title: "1 stop" / "2 stops" in the
  warning accent, or a quiet "Nonstop". Previously a connection only showed as
  an extra code inside a parenthesised route, which is easy to read past.
- The route is **drawn** rather than written — each airport as a chip joined by
  legs, with connection airports picked out in the accent colour.
- Each connection gets its own line: "Change at LIS — TP123 · departs 14:30",
  using the connecting-flight details that were already captured in the edit
  form but never shown anywhere else.
- Legacy bookings that only carry `layovers` codes render the same way;
  `connections` wins when both are present, and blank connection rows are
  ignored.
- The schedule's flight rows now say "· 1 stop" after the route, so a
  connection is visible there too.

## 2026-08 — Full-screen photo viewer: smoother

### Photos
- **The photo follows your finger.** The swipe only acted on release before, so
  the drag itself did nothing and the change arrived late — which read as lag,
  and led to swiping repeatedly. It now tracks the finger 1:1, resists at the
  first and last photo, and settles with a short slide.
- **The page behind no longer scrolls.** The viewer sets `touch-action:
  pinch-zoom` (panning blocked, zoom kept) and the body is locked while it's
  open, which also stops the repeated horizontal swipes that were triggering the
  browser's back gesture and landing people on another page.
- **A gesture picks an axis once and keeps it,** so a vertical drag is left
  alone instead of half-swiping.
- **Nothing jumps while a photo loads.** The viewer is a column with the image
  stage taking the space that's left, so the uploader and caption bar sit at the
  bottom from the first frame instead of floating mid-screen. The image fades in
  when it decodes, and the spinner only appears if the load is actually slow.
- **Opening is quicker.** The full-size image starts decoding when a tile is
  pressed rather than when the tap completes, and neighbours are decoded while
  you look, so a swipe lands on an image that's ready.
- A drag no longer counts as a tap on the backdrop, so swiping can't dismiss the
  viewer by accident; tapping the photo still closes it, and tapping the caption
  bar doesn't.

## 2026-08 — Swipe between photos, and captions

### Photos
- **Swipe to move between photos** in the full-screen view — left for the next,
  right for the previous, stopping at each end rather than wrapping. A drag
  under 60px, or one that's more vertical than horizontal, is ignored so a
  scroll isn't mistaken for a swipe. Pointer devices get arrows and arrow keys;
  a counter shows where you are.
- The neighbouring photos are decoded ahead of time, so a swipe lands on an
  image that's already there.
- The open photo is tracked by id, not position. The album is a live query — if
  someone else uploads while you're looking, the list reorders, and an index
  would quietly leave you on a different photo. If the photo you're viewing is
  deleted, the view closes on its own.
- **Captions, without slowing down uploading.** Nothing is asked before or
  during an upload. Afterwards: the uploader can add or edit a caption inline in
  the full-screen view; the "uploaded" snackbar offers **Add captions**, which
  drops you into selection mode with that batch already selected; and the
  selection pill can write one caption across everything you picked — useful for
  tagging a run of photos with a day or a place.
- Captioning is offered only on your own photos, matching the Firestore rule
  that allows a photo update just for its uploader.

## 2026-08 — App icon fixes

### PWA
- The manifest declared `/ClearLogoWhiteCircle.png` as both 192×192 and
  512×512, but the file is 467×442 — neither size, and not square. Chrome needs
  a genuine 512×512 to consider the app installable, and a 1:1 slot was
  stretching the mark. Generated real `icon-192`, `icon-512`,
  `icon-maskable-512` and `apple-touch-icon` (180) from the existing black logo:
  black mark, opaque white ground, same black-and-white identity.
- That file is a white mark on a transparent background, so the icon was
  invisible against a light wallpaper and the PWA splash was a white logo on
  the white `background_color`. The new icons are opaque, so they read the same
  on any wallpaper and in either theme.
- `purpose: "any maskable"` promised a safe zone the artwork didn't have, so a
  circle crop clipped the outer ring. The maskable icon is now a separate asset
  with the mark inside the 80% safe zone; the plain icons are declared `any`.
- Notification payloads used the same transparent logo as their `icon`, which
  is displayed as-is and vanished on a light notification shade — now the
  opaque icon. The `badge` still uses the transparent logo, which is correct:
  it's rendered as an alpha silhouette.

Existing home-screen shortcuts keep whatever icon they captured when they were
added — iOS doesn't refresh it. This applies to new installs.

## 2026-08 — Repo hygiene

### Tests
- `npm test` passes again. `app.spec.ts` failed with `NG0201: No provider found
  for SwUpdate` — `App` injects `PwaUpdateService`, which injects `SwUpdate`,
  and the test module never provided it. The spec now registers the worker
  disabled and provides a router, and its second test asserts the router outlet
  renders instead of the CLI scaffold's "Hello, travel-organizer" heading.
- Deleted `src/app/app.html`, the untouched Angular starter placeholder. `App`
  declares an inline template, so the file was unreferenced — and it bound
  `title()`, a member the component doesn't have.

### Local dev
- `npm run dev:api` starts again. `scripts/dev-server.js` required
  `api/plaid-link`, `api/plaid-exchange` and `api/plaid-transactions`, which
  were consolidated into `api/plaid.js` — the server threw on startup.
- It now serves every route in `api/`, not the eight it knew about, and handles
  GET as well as POST, strips the query string before matching a route, and
  exposes `req.query` — several routes dispatch on `?action=` or `?token=` and
  were unreachable. `res.send()` was added for the photo download's image bytes.

### Cleanup
- Dropped the unused `photos` composite index (`tripId` + `uploadedAt`); that
  query hasn't ordered server-side since the album fix.
- Dropped `MatFormFieldModule`/`MatInputModule` from the photos component —
  imported but never used.

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
