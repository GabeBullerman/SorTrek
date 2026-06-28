# SorTrek — Security Audit

Scope: Firestore/Storage rules + the `api/` serverless surface. Run the
black-box checks any time with `node scripts/security-probe.mjs`.

Legend: 🔴 High · 🟠 Medium · 🟡 Low · 🟢 OK

## Findings

### 🔴 H1 — Serverless API endpoints have no authentication
`/api/ai-advisor`, `/api/find-plans`, `/api/transport`, `/api/flight-status`,
`/api/email-scraper`, `/api/place-photo`, `/api/plaid-*` accept anonymous POSTs.
The AI/external ones call **paid** third parties (Groq, Tavily, AviationStack/
AeroDataBox). A scripted client can call them without logging in.
- **Impact:** cost-amplification abuse — an attacker runs up your Groq/Tavily/
  flight-API bills and can exhaust free-tier quotas (denial of service by cost).
- **Fix:** require a Firebase ID token. Client sends `Authorization: Bearer
  <idToken>`; the endpoint verifies it with `getAuth().verifyIdToken()` (the
  Admin SDK is already wired up in `api/_firebaseAdmin.js`). Reject with 401.

### 🔴 H2 — No rate limiting
20 rapid anonymous requests were all processed (0 × 429). Combined with H1, the
paid endpoints can be flooded.
- **Fix:** add per-IP rate limiting. On Vercel the robust option is **Upstash
  Redis / Vercel KV** + `@upstash/ratelimit` (in-memory limiting is unreliable
  because serverless scales to many instances). Even a modest cap (e.g. 30 req/
  min/IP) on the AI routes neutralizes abuse.

### 🟠 M1 — Any signed-in user can read any trip that has an invite token
`firestore.rules` `trips` read allows `resource.data.inviteToken != null`
regardless of membership. A logged-in user who learns a trip's document id can
read the full trip (costs, etc.) if an invite link was ever generated.
- **Mitigating factor:** trip ids are random ~20-char Firestore ids (not
  enumerable).
- **Fix:** drop the `inviteToken != null` read clause and move invite
  acceptance to an Admin-SDK endpoint that verifies the token value server-side,
  so the client never needs broad trip read.

### 🟠 M2 — All user profiles are world-readable to any signed-in user
`users` read is `if isSignedIn()`. Exposes every user's email, displayName,
homeCity, photoURL **and `fcmToken`** to any authenticated account → user
enumeration + push-token exposure.
- **Fix:** move `fcmToken` to a private subcollection (`users/{uid}/private/...`)
  readable only by the owner; keep only the fields needed for name/avatar
  resolution publicly readable, or restrict reads to co-members.

### 🟡 L1 — Error detail leakage
`/api/ai-advisor` returns the upstream `detail` to the client; `transport` /
`find-plans` return `err.message`. Minor information disclosure.
- **Fix:** log server-side, return a generic message in production. *(fixed for
  ai-advisor in this pass)*

### 🟡 L2 — `X-Content-Type-Options: nosniff` missing on API responses
- **Fix:** set the header on API responses. *(fixed in this pass)*

### 🟡 L3 — `place-photo` follows redirects after the host allowlist
`fetch(url, { redirect: 'follow' })` validates the initial host but then follows
redirects anywhere. Low risk (Google hosts don't open-redirect), but defense in
depth says re-validate.
- **Fix:** use `redirect: 'manual'` (or re-check the final URL's host).

## What's already solid 🟢
- **Trip-scoped Firestore content** (bookings, itinerary, expenses, packing,
  photos, documents) is membership-gated via the parent trip — removing a
  collaborator instantly revokes access. Ownership/schedule-editor/share fields
  are protected from collaborator self-promotion.
- **Schedule propose→approve** rules correctly prevent a proposer from approving
  their own item.
- **Storage rules** enforce owner-only writes, size caps (15 MB photos / 25 MB
  docs) and image content-type.
- **SSRF guard** on `place-photo` blocks cloud-metadata, localhost, file://, and
  non-Google hosts (verified).
- **Public share token** is a 128-bit hex value (not guessable); the endpoint
  handles garbage/injection tokens with 404, never leaking errors.
- **HSTS** is present (`max-age=63072000; includeSubDomains; preload`).

## Priorities
1. H1 + H2 together (auth + rate limit on the paid endpoints) — biggest risk.
2. M1, M2 (tighten Firestore read rules).
3. L1–L3 hardening.
