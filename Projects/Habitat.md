# Habitat — Real-Time Focused-Work Session Platform

> Owner: Gabriel Bullerman
> Purpose: stack-broadening side project — hit a modern Tier-1/2 T3-adjacent stack in a load-bearing way
> Existing work to reference: Portfolio (React 18 + Vite + Three.js), Lusiant (Next.js 16 + Supabase + Stripe), SorTrek (Angular 21 + Firebase + Groq + Plaid)

---

## Elevator pitch

A live "focus room" web app for coworking, study groups, and writing sprints. Users create or join a room; the room has a **shared timer** (Pomodoro or custom), **live presence** of everyone in the session, a **commitment board** where each person types what they'll finish this session, and a chat sidebar. When the session ends, an **LLM reads the commitments + chat** and generates a group recap ("Sarah shipped the auth flow, Marcus stayed stuck on the CSV bug, everyone earned a streak point"). Rooms can be **public** (drop-in coworking) or **invite-only**.

Think of it as **Focusmate meets Discord voice, but async and text-first**.

---

## Why this specific project

Real-time collaboration forces a bunch of modern-stack decisions that don't come up in CRUD apps: presence, optimistic UI, pub/sub, WebSocket auth, race conditions, backpressure. Almost every gap this repo is designed to close falls out naturally from those decisions, so nothing feels bolted on.

---

## Target tech stack (all load-bearing, no checkbox tech)

| Layer | Choice | Why it's load-bearing here |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | Not just an SSR shell — RSC + Server Actions co-exist with the tRPC layer; Route Handlers host the WebSocket upgrade endpoint |
| Language | **TypeScript** | End-to-end types via tRPC |
| API layer | **tRPC v11** | Every mutation (create room, submit commitment, toggle status) is a typed procedure; no OpenAPI/Zod schema drift |
| Validation | **Zod** | Owned inside tRPC procedure input/output; also validates websocket message envelopes |
| Data layer | **Drizzle ORM** | Schema-first, no runtime engine, no codegen ceremony. Deliberately different from Prisma so you can talk about the tradeoffs |
| Database | **PostgreSQL 16** | Relational depth: users, rooms, sessions, memberships, commitments, streaks, events |
| Server state | **TanStack Query** | Optimistic UI for "toggle break," "check commitment done," etc. Cache invalidation via tRPC's built-in query key helpers |
| Realtime transport | **Redis pub/sub + native WebSockets** (or **Socket.IO** if you want to skip low-level plumbing) | Multiple app instances need to broadcast presence/timer events; Redis is the fanout |
| UI library | **shadcn/ui + Radix Primitives** | Accessible primitives; you own the component code (perfect for a portfolio piece) |
| Styling | **Tailwind CSS v4** | Matches your Lusiant baseline |
| Motion | **Framer Motion** | Timer transitions, presence enter/exit animations — reuses your existing muscle |
| Component workbench | **Storybook 8** | Document `Timer`, `PresenceStack`, `CommitmentCard`, `DiceRoller`… serves as visual regression baseline |
| Unit tests | **Vitest + React Testing Library** | Test the timer state machine, streak calculator, presence reducer |
| E2E tests | **Playwright** | Two-browser scenarios: user A creates room, user B joins, verify B appears in A's presence stack |
| Auth | **Auth.js v5 (NextAuth successor)** with email magic-link + Google OAuth | Standard for the Next ecosystem; JWT session tokens |
| LLM | **Groq (Llama-3.3-70B)** or **Claude Sonnet** via server-side proxy | For the end-of-session recap generator |
| Error/perf tracking | **Sentry** | Live apps care about tail-latency errors; instrument the WebSocket handler + server actions |
| Local dev | **Docker Compose** | app + postgres + redis in one `docker compose up` |
| CI | **GitHub Actions** | typecheck → lint → unit tests → Playwright (headless) on PR |
| Deploy | **Vercel** for the Next app + **Railway/Neon** for Postgres + **Upstash** for Redis | Or self-host on Fly.io if you want to close the AWS-adjacent gap on this project too |

### Stack-coverage checklist (map to portfolio gap list)

- [x] Vitest + RTL (Tier 1)
- [x] Playwright (Tier 1)
- [x] GitHub Actions CI (Tier 1)
- [x] Drizzle ORM (Tier 1)
- [x] TanStack Query (Tier 2)
- [x] shadcn/ui + Radix (Tier 2)
- [x] Storybook (Tier 3)
- [x] Docker (Tier 2)
- [x] Sentry (Tier 2)
- [x] tRPC (Tier 3)
- [x] WebSockets / real-time (breadth)
- [x] LLM integration (already in your wheelhouse; strengthens it)

**Total gap-list items covered by this single project: ~11.**

---

## Core user stories (v1 scope)

1. **Anonymous visitor → registered user**: sign up with email magic link or Google.
2. **User creates a room**: chooses name, timer style (Pomodoro 25/5, custom), visibility (public/invite-only), and an optional theme.
3. **User joins a room**: sees who's currently in the session, their status (working / on break / away / done), and their commitment for the session.
4. **User posts a commitment** at the start of a session: "Ship the OAuth callback handler."
5. **Timer syncs**: everyone in the room shares the same countdown, driven by the server. Someone starts the timer, everyone's clock updates within ~200ms.
6. **User toggles status**: working ↔ on break ↔ away. Other users see the change immediately.
7. **User marks their commitment done** with a note. Confetti / small animation.
8. **Session ends**: server generates an LLM-written recap of what everyone did (based on commitments + chat) and stores it. Members can see past recaps.
9. **User's streak** increments if they logged in and posted a commitment. Shown on their profile.
10. **Public room discovery**: browse a lobby of currently-active public rooms with a live "N people focusing" count.

### Explicit non-goals for v1
- No voice/video (that's Focusmate; this is text-first)
- No screenshare
- No payments
- No mobile app (responsive web only)
- No AI accountability partner in v1 (add in v2)

---

## Data model (Drizzle schema sketch)

```ts
// db/schema.ts

users               // id, email, name, image, streak_days, last_active_at
rooms               // id, slug, name, visibility, theme, timer_config (jsonb), created_by, created_at
memberships         // user_id, room_id, role, joined_at    (PK: user_id, room_id)
sessions            // id, room_id, started_at, ends_at, timer_state, recap_md   -- one row per timer run
commitments         // id, session_id, user_id, text, done, done_at, note
statuses            // session_id, user_id, status ('working'|'break'|'away'|'done'), updated_at   (PK: session_id, user_id)
messages            // id, session_id, user_id, body, created_at
events              // id, session_id, kind, payload (jsonb), created_at    -- append-only audit for realtime replay
```

Indexes to actually add up front:
- `rooms(slug)` UNIQUE
- `memberships(room_id)`
- `sessions(room_id, started_at DESC)`
- `events(session_id, created_at)`
- `messages(session_id, created_at)`

### Why the `events` table matters
When a user joins a room mid-session, the server replays the last N events (started_at, timer_started, status_changed, message_posted…) so the client hydrates instantly. Without this, late-joiners see a blank room until the next broadcast. This is a good place to talk about **event sourcing lite** in interviews.

---

## Architecture

```
+-------------------+         +--------------------+
|  Browser client   |  WSS    |  Next.js server    |
|  (Next.js RSC +   |<------->|  Route Handler:    |
|   TanStack Query) |  HTTPS  |    /api/ws         |
+-------------------+         |  tRPC:             |
                              |    /api/trpc/*     |
                              +---------+----------+
                                        |
                       +----------------+---------------+
                       |                                |
                   +---v----+                    +------v-----+
                   | Redis  |    pub/sub         | PostgreSQL |
                   | (pubsub|<------------------>| (Drizzle)  |
                   |  + KV) |                    +------------+
                   +--------+
                       |
                   +---v------+
                   |  Sentry  |
                   +----------+
```

Realtime flow:
1. Client opens WebSocket → server authenticates via cookie → subscribes to `room:{id}` channel.
2. Any mutation (status change, message, timer tick) goes through tRPC → writes to Postgres → publishes an event to Redis on `room:{id}`.
3. Server has one subscriber per app instance; it fans out to every connected WebSocket in that instance.
4. Clients apply the event optimistically to TanStack Query cache.

### Timer sync approach (this is the trickiest part)
Don't sync a countdown across clients — sync a `session_ends_at` timestamp. Each client renders its own countdown against `session_ends_at - now()`. Clock skew is handled by a periodic `serverTime` ping. **Never** send `remainingSeconds` from the server — that guarantees drift.

---

## Suggested folder layout

```
habitat/
├── app/                        Next.js App Router
│   ├── (marketing)/            landing, pricing, about
│   ├── (app)/
│   │   ├── layout.tsx          authed shell
│   │   ├── rooms/
│   │   │   ├── page.tsx        lobby (list of public rooms)
│   │   │   ├── new/page.tsx    create-room wizard
│   │   │   └── [slug]/
│   │   │       ├── page.tsx    room view
│   │   │       └── recap/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── trpc/[trpc]/route.ts
│   │   ├── ws/route.ts         WebSocket upgrade
│   │   └── auth/[...nextauth]/route.ts
│   └── globals.css
├── components/
│   ├── ui/                     shadcn primitives
│   ├── room/
│   │   ├── Timer.tsx
│   │   ├── PresenceStack.tsx
│   │   ├── CommitmentBoard.tsx
│   │   └── ChatSidebar.tsx
│   └── marketing/
├── db/
│   ├── schema.ts
│   ├── migrations/
│   └── client.ts
├── lib/
│   ├── trpc/
│   │   ├── router.ts
│   │   ├── procedures/
│   │   │   ├── rooms.ts
│   │   │   ├── sessions.ts
│   │   │   └── commitments.ts
│   │   └── context.ts
│   ├── realtime/
│   │   ├── redis.ts
│   │   ├── channels.ts
│   │   └── ws-server.ts
│   ├── llm/
│   │   └── recap.ts            Groq/Claude client + prompt
│   └── auth.ts
├── stories/                    Storybook stories co-located
├── tests/
│   ├── unit/                   Vitest
│   └── e2e/                    Playwright
├── docker-compose.yml
├── .github/workflows/ci.yml
├── drizzle.config.ts
└── sentry.*.config.ts
```

---

## Milestones (rough weekend-scale)

**Weekend 1 — v0 walking skeleton**
- Scaffold Next.js 15 + Auth.js + Drizzle + Postgres in Docker.
- Users can sign up, create a room, see the room page. No realtime yet.
- Ship the CI pipeline (GH Actions running Vitest, even if there's only 1 test).

**Weekend 2 — realtime**
- Redis in Docker. WebSocket route handler. Presence works: two browsers can see each other's status.
- Server-side timer with `session_ends_at`. Timer starts/stops sync.

**Weekend 3 — commitments + chat + polish**
- Commitment board with add/done/note.
- Chat sidebar.
- shadcn'd everything. First Storybook stories for `Timer` and `CommitmentCard`.

**Weekend 4 — recap + tests + observability**
- LLM recap generator (server action → Groq/Claude → save markdown to `sessions.recap_md`).
- Playwright E2E: two contexts, verify presence sync + timer sync.
- Sentry wired (front and back).
- Deploy to Vercel + Neon + Upstash. Public URL, `/lobby` shows real rooms.

Everything past that is v2 territory: mobile responsiveness polish, invite links, AI accountability partner, streaks page, past-recap browser.

---

## Gotchas to know before you start

1. **WebSocket in Next.js App Router**: as of Next 15, the recommended path is a Route Handler that hijacks the request. On Vercel this won't work in the default runtime — WebSocket connections need a persistent server. Either self-host the WS route on Fly.io / Railway, use a hosted realtime service (**Ably** or **Pusher** — completely valid choice, and it lets you skip the Redis plumbing), or use **Cloudflare Workers Durable Objects**. If you want the Redis/WS gap-closing story on your resume, self-host that piece.
2. **Auth over WebSocket**: don't do query-string auth. Read the session cookie during the HTTP upgrade, attach the user to the WebSocket. Reject unauth'd upgrades.
3. **tRPC + WebSocket**: tRPC has a WebSocket link, but for something as event-heavy as this, don't tunnel *everything* through it — use tRPC for mutations, plain WS for the realtime fanout. Split makes debugging saner.
4. **Timer drift**: as noted above, sync `endsAt`, never `remainingSeconds`.
5. **Storybook + Tailwind v4**: their integration is still stabilizing as of writing; if you hit friction, pin Tailwind v3.4 for Storybook until it settles. Not worth a rabbit hole.
6. **Drizzle migrations**: use `drizzle-kit generate` + `drizzle-kit migrate`, not `push`, for anything you'll actually deploy. `push` is fine for prototyping.
7. **Playwright + WebSockets**: use two `browser.newContext()` instances in the same test; each is a separate cookie jar. Don't try to reuse one context — you'll fight session collisions.

---

## What to intentionally NOT do

- Don't build a mobile app. Responsive web is enough for the story.
- Don't roll your own auth. Auth.js v5 or Clerk.
- Don't add Kubernetes. Docker Compose locally is the point.
- Don't add feature flags, i18n, analytics beyond Vercel Analytics + Sentry. Scope creep is the enemy.

---

## Concrete first prompt for a fresh Claude Code session

> "I want to build Habitat, a real-time focused-work session app. Read `Habitat.md` in this directory for the full brief. Start by scaffolding the Next.js 15 project with TypeScript, Tailwind v4, shadcn/ui, Drizzle + Postgres via docker-compose, and Auth.js v5 (magic link + Google). Ship a minimal room-creation page and the CI workflow. Do not add realtime, tRPC, or Redis yet — I want a walking skeleton first."
