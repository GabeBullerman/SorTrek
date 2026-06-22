# SorTrek — Improvement Backlog (review before committing)

> This file is **uncommitted**. It is both (a) the idea list Gabe asked for and
> (b) the worklist the scheduled 2:09 AM continuation works through.
> Rule: implement safe items in the working tree, **never `git commit`/`push`** —
> Gabe reviews and commits himself. Mark `[x]` when an item builds clean.

Risk legend: 🟢 safe/low-risk · 🟡 needs judgement · 🔴 discuss first (don't build)

---

## 1. Mobile formatting (highest priority — only 5 media queries exist app-wide)

- [x] 🟢 **Trip-detail hero**: clamped h1 (2-line), shorter hero, non-overflowing
      actions on mobile. ✅
- [x] 🟢 **10-tab horizontal nav**: momentum scroll added; active-tab rule already
      present. ✅
- [x] 🟢 **Dialogs full-screen on mobile**: global rule in styles.scss
      (cdk-overlay-pane/mat-mdc-dialog → 100vw, scrollable content). ✅
- [x] 🟢 **Grids → fewer columns**: trips/past-trips → 1col, photos → 2col, costs
      breakdown stacked. ✅
- [x] 🟢 **Cards stack**: people/bookings/documents cards wrap on mobile. ✅
- [x] 🟢 **Touch targets ≥44px** on mobile action buttons; `.safe-area-inset` utility
      added (NOTE: utility created but not yet applied to shell — follow-up). ✅ partial
- [ ] 🟡 **Sidenav**: confirm `over` mode + backdrop on mobile feels right; add a
      persistent top app-bar with hamburger if the logo header is hard to reach.
- [ ] 🟡 **Currency converter & AI chat**: input/keyboard sizing on mobile.

## 2. In-app Guide gaps

- [x] 🟢 **Add missing guide pages**: Overview & Map, Photos / Shared Album,
      Packing List, Profile & Settings (PAGES array in
      `guide-modal.component.ts`, matching existing shape/tone). ✅ done
- [x] 🟢 **Audit `gifPath` SVGs** in `public/guide/` — all 10 existing SVGs were
      present; created 4 placeholders (overview/photos/packing/profile.svg) for the
      new pages, matching house style. ✅ done
- [ ] 🟡 **Status honesty**: every page says "Fully Implemented"; Transport notes
      "requires API key" — reflect what's actually configured in prod.

## 3. Unintuitive workflows (UX friction)

- [x] 🟡 **Travel Companions vs App Members** — added crisp disambiguating copy under
      both headings (App Members = see & edit, need account; Companions = cost-split &
      assign, no account). ✅ (unifying the two systems still a longer-term option)
- [ ] 🟡 **Add-passenger flow** on bookings: clarify that passenger dropdown is fed by
      trip people; allow free-text add inline.
- [x] 🟢 **"Change cover photo"** discoverability — added hint copy + a "Loading photo
      options…" line while Maps initializes (trip-form-dialog, copy/UI only). ✅
- [ ] 🟡 **AI "Find Plans" → Schedule**: make "add to schedule" from a suggestion
      obvious and one-tap.
- [ ] 🔴 **BUG — "Find Plans" returns date-invalid events**: suggestions include
      events that aren't actually available on the selected day. Repro: Portugal trip,
      Aug 25 (day 1) returned items whose own descriptions said "on August 9th, 2026"
      and "from August 8–15, 2026" — impossible to attend. Fix in `api/find-plans.js`
      (+ schedule.component.ts caller): pass the target date, instruct the model to
      ONLY return events occurring on that date or within an availability range that
      INCLUDES it, AND post-filter/validate results server-side (parse any date/range
      in the suggestion; drop ones that don't cover the target date) so bad ones never
      reach the schedule. (Gabe flagged 2026-06-22.)
- [x] 🟢 **Empty states**: audited — all tabs already had friendly empty states (global
      `.empty-state`); added missing primary CTAs to Bookings/Costs/Packing. ✅

## 4. Feature ideas

- [x] 🟢 **Calendar export (.ics)** — new ics-export.service.ts + "Add to Calendar"
      button on Overview; flights/hotels/cars + itinerary items → downloadable .ics
      (no deps, hand-rolled RFC-5545). ✅
- [ ] 🟡 **Live weather forecast** for trip dates on Overview/Schedule (AI gives tips;
      add real forecast via a weather API).
- [ ] 🟡 **Expense settle-up** (Splitwise-style "who owes whom") on top of existing
      per-person split.
- [ ] 🟡 **Attach files to a booking** (boarding pass / hotel confirmation PDF/image),
      view inline — reuse the Document Vault storage path.
- [x] 🟢 **Countdown badge** on upcoming trip cards ("Today"/"Tomorrow"/"N days to go",
      future trips only). ✅
- [x] 🟢 **Sort upcoming trips by soonest** — trips list now orders ongoing → soonest
      upcoming → most-recent past. ✅
- [ ] 🟡 **Flight-status push notifications** (you already have the flight-status API;
      notify on delay/gate change).
- [ ] 🟡 **Packing templates by trip type** (beach/ski/business) + auto-suggest from
      duration & weather.
- [ ] 🟡 **Read-only public share link** for an itinerary (family not on the app).
- [x] 🔴→✅ **Dark mode** — token architecture (styles/_tokens.scss light+dark),
      Material dark theme, ThemeService (persists + follows OS), toolbar toggle, and
      migrated ~191 colors across 24 component stylesheets. CORE DONE.
      ⚠️ Accent polish pending a VISUAL review in dark mode: secondary indigo text
      (#3949ab/#5c6bc0 — no token yet, low contrast on dark), amber warning panels,
      blue info strips, a few hover tints, and any hardcoded dark text left on
      now-dark panels (e.g. booking-dialog status-card). Toggle dark + flag what looks off.
- [x] 🔴→✅ **Timezone-aware flight times** — DONE across Bookings, Schedule, and
      Overview "Bookings at a Glance" (TimezoneService + ~140-airport dataset; labels
      each time with its airport zone, e.g. "MST"/"CEST", only when the flight crosses
      zones).
      FOLLOW-UP (correctness): times are stored as wall-clock, not tagged with the
      airport zone — labels are accurate when entered/viewed consistently; a fully
      correct model would store each time against its airport's IANA zone.
- [ ] 🟡 **Budget vs actual** (set trip budget, track burn-down on Costs).
- [x] 🟢 **Search/filter** within Bookings, Costs, Documents — search field + clear
      button + "no matches" line, client-side, additive. ✅

## 5. Technical / robustness

- [x] 🟢 Set Firestore `ignoreUndefinedProperties: true` globally in app.config.ts
      (kept the stripUndefined helpers as belt-and-suspenders). ✅
- [ ] 🟡 Verify **Storage security rules** for `photos/` and `tripDocuments/` are hardened
      like Firestore (member-scoped read, uploader-scoped write).
- [ ] 🟡 **Bundle budget**: initial bundle 909 kB vs 500 kB budget — lazy-load heavy
      routes (maps, AI) or raise the budget consciously.
- [x] 🟢 **A11y pass**: ~26 aria-labels on icon buttons, ~5 aria-hidden on decorative
      icons, improved gallery img alt across high-traffic templates. ✅
      (dialog focus-trap audit still TODO — Material handles most by default)

## 6. Pending manual steps (Gabe — outside the code)

- [ ] Deploy Firestore rules so photo orphan-cleanup delete works:
      `firebase deploy --only firestore:rules`
- [ ] One-time: remove pre-existing orphan photo docs in Firebase console.
- [ ] Vercel project rename + Firebase display-name / Auth public-facing name = SorTrek.
- [ ] favicon.ico still old art (PNG theme-aware favicons already wired).

---

### Dev-environment fix
- Local `ng serve` was failing to compile: `push-notification.service.ts` references
  `environment.vapidKey`, but the dev env type (environment.ts / environment.example.ts)
  lacked it (only environment.prod.ts had it). Added `vapidKey` to both so dev builds.
  Local environment.ts also still had placeholder Firebase keys → must be filled to log in.

### Dark-mode iteration (Gabe feedback)
- Brand surfaces were too bright in dark (sidenav/toolbar used --st-primary which is
  lightened in dark → white logo/text washed out). Added a dedicated `--st-brand`
  token = #1a237e in BOTH modes; pointed shell sidenav + toolbar at it. White
  logo/text readable again. (Can shift to a lighter blue later per feedback.)
- Replaced the plain mat-icon theme toggle with the animated "Within" toggle
  (theme-toggles, MIT) reimplemented natively as ThemeToggleComponent (inline SVG +
  CSS transforms gated on :host-context(.dark)). Wired to ThemeService in the toolbar.

### Dark-mode contrast pass + toggle/logo (Gabe feedback round 2)
- Added token families (--st-primary-soft, --st-primary-tint-*, --st-success-*,
  --st-warn-*) with brighter dark greens/ambers; migrated leftover hardcoded colors
  across ~16 component stylesheets (schedule cards, booking ticket/passenger text,
  packing checked-green, etc.). Build clean.
- Replaced theme toggle with animated "Within" (ThemeToggleComponent); fixed it to
  stay white on the dark-blue toolbar in both themes (--st-brand-contrast).
- Logos FINALIZED. Gabe renamed assets; public/ now holds exactly:
  * WhiteLogoNoBackground.png  (white, transparent)
  * BlackLogoNoBackground.png  (black, transparent)
  * ClearLogoWhiteCircle.png   (logo in a white circle — self-contained)
  Reference mapping (all old LightBG/DarkBG/*BackgroundLogo refs removed):
  * Dark-blue sidenav (shell) → ClearLogoWhiteCircle.png
  * Login (theme-aware) → Black (light) / White (dark)
  * Favicon (index.html) → Black (light browser tab) / White (dark tab)
  * apple-touch-icon + PWA manifest icons + notification icon/badge → ClearLogoWhiteCircle.png

### Worklog (scheduled runs append here)
- Guide: added 4 pages (Overview&Map, Photos, Packing, Profile) to guide-modal.component.ts
  + created public/guide/{overview,photos,packing,profile}.svg placeholders. Build clean.
- Mobile: additive @media(max-width:600px) across styles.scss (full-screen dialogs +
  safe-area util), trip-detail (hero/tabs), trips/past-trips/photos/costs grids,
  people/bookings/documents cards, 44px touch targets. Build clean.
- People: disambiguating copy for App Members vs Travel Companions (people.component
  .html/.scss, copy-only, no logic). Build clean.
- Trips: countdown badge on upcoming trip cards (trips.component .ts/.html/.scss). Build clean.
- Firestore: ignoreUndefinedProperties:true in app.config.ts. Build clean.
- Trip dialog: cover-photo discoverability hint + maps-loading line. Build clean.
- Calendar: ics-export.service.ts + Overview "Add to Calendar" button. Build clean.
- A11y: aria-labels/aria-hidden/alt across shell, trips, past-trips, trip-detail,
  overview, photos, people, bookings, documents. Build clean.
- Empty states: added CTAs to bookings/costs/packing empty states. Build clean.
- Search/filter: client-side search boxes on bookings/costs/documents. Build clean.
- Sort trips: trips list ordered ongoing→soonest-upcoming→recent-past (trips.component.ts).
- Dark mode: styles/_tokens.scss + Material dark + ThemeService + toolbar toggle;
  app.ts inits theme; ~191 colors migrated to tokens across 24 component stylesheets.
  Build clean. (accent-contrast polish pending visual review)
- Timezone: airport-timezones.ts (~140) + timezone.service.ts; flight times labeled
  with airport zone when crossing zones in Bookings + Schedule + Overview
  (.tz-label global style). Build clean.

--- Autonomous safe-work phase complete (10 items). Remaining items are 🟡 (need
    Gabe's judgement) or 🔴 (discuss first). The 2:09 run may pick up well-understood
    🟡 items; nothing committed. ---
