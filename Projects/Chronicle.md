# Chronicle — Personal Life-Log with Async Ingestion Pipeline

> Owner: Gabriel Bullerman
> Purpose: stack-broadening side project — hit the Python/AWS/queue/IaC gaps in a load-bearing way
> Existing work to reference: Portfolio (React 18 + Vite + Three.js), Lusiant (Next.js 16 + Supabase + Stripe), SorTrek (Angular 21 + Firebase + Groq + Plaid)

---

## Elevator pitch

Throw stuff at it during the day: photos, voice memos, receipts, screenshots, links, tweets. A **background worker** processes each item — OCR the receipts, transcribe the voice memos, extract text from screenshots, embed everything into a vector store, tag automatically. Once a week, an **LLM writes a "field report"** — a 1–2 page recap of what you did, what you spent, what you read — and emails it to you. Bonus: **ask questions of your own history** ("what restaurants did I like in NYC last April?") and get RAG-style answers.

Think of it as **a private, self-hosted Day One + Rewind.ai + Google Photos, but with the receipts side of Copilot for spending baked in**.

---

## Why this specific project

The frontend side of your gap list is covered by Habitat. This project deliberately swings the other way: **Python-first backend, real AWS (not Vercel-abstracted), async job pipeline, infrastructure-as-code**. Everything a hiring manager for a backend or data-adjacent role would probe is exercised for real here.

---

## Target tech stack (all load-bearing)

| Layer | Choice | Why it's load-bearing here |
|---|---|---|
| Backend framework | **FastAPI** (Python 3.12) | Async-first, Pydantic-schema-typed, feels like TS-Zod-Express. Ideal for a job queue producer + LLM orchestration |
| Language | **Python** for backend/workers; **TypeScript + Next.js** for the small web client | You already have TS chops — the point is to add Python competence |
| Data layer | **SQLAlchemy 2.x + Alembic** (or **Prisma-Client-Python** if you want to feel Prisma explicitly) | Real Python ORM experience |
| Database | **PostgreSQL 16 + pgvector** | Metadata + embeddings in one place. Simpler than a dedicated vector DB |
| Job queue | **Celery + Redis** (or **RQ** if Celery's config surface feels too heavy) | Every upload dispatches jobs: OCR, transcribe, embed, tag |
| Message broker / cache | **Redis 7** | Celery broker + result backend + short-term caches |
| Object storage | **AWS S3** | Real S3, real signed URLs, real bucket policy — not Firebase Storage |
| Compute (light) | **AWS Lambda** | Triggered by S3 events for thumbnail generation and image dominant-color extraction. Cheapest way to learn EventBridge + S3 events |
| Compute (heavy) | **AWS ECS Fargate** or a single **AWS EC2 t3.small** running the FastAPI app + Celery workers behind Docker Compose | ECS is the "real" story for a resume; EC2 is fine for actually running it. Pick one |
| Email delivery | **AWS SES** | Weekly digest emails go here. Real deliverability config: verified domain, SPF/DKIM |
| Managed database | **AWS RDS Postgres** or **Neon** | RDS for the AWS story; Neon for cheaper dev — decide based on cost tolerance |
| IaC | **Terraform** | Provision RDS, S3, SES, Lambda, IAM roles, VPC, secrets. **This is the piece "AWS on a resume" actually means** |
| Local dev | **Docker Compose** | FastAPI + Postgres + Redis + Minio (fake S3) — one `docker compose up` |
| API to client | **REST + OpenAPI** (FastAPI generates it) *or* **Strawberry GraphQL** | REST is fine; add Strawberry only if you want to close the GraphQL gap here |
| Web client | **Next.js 15** (thin) — mainly a viewer for the timeline + a chat UI for the RAG queries | Small; the API is the star |
| LLM | **Anthropic Claude** (Sonnet 4.5 for recap, Haiku for tagging) via server-side calls | Different model tiers for different jobs is a real production pattern |
| Embeddings | **OpenAI text-embedding-3-small** or **Voyage AI** | Used for RAG over your history |
| Auth | **Auth.js v5** for the web client → JWT → FastAPI validates | Passing JWT from Next → FastAPI is a common pattern; good to have done once |
| Error tracking | **Sentry (Python + JS SDKs)** | Instrument FastAPI middleware + Celery task handlers |
| CI | **GitHub Actions** | pytest + mypy/pyright + `terraform plan` on PR; `terraform apply` only via manual workflow_dispatch |
| Secrets | **AWS Secrets Manager** (referenced by Terraform + FastAPI env) | Not `.env.local` in prod |

### Stack-coverage checklist (map to portfolio gap list)

- [x] Python (FastAPI) (Tier 3)
- [x] SQLAlchemy or Prisma-py (Tier 1 equivalent — ORM story)
- [x] Docker (Tier 2)
- [x] Real AWS (S3 + Lambda + SES + RDS + IAM) (Tier 2)
- [x] Terraform / IaC (Tier 4 → moved up because AWS lives or dies by IaC)
- [x] Redis + message queue (Tier 3)
- [x] Sentry (Python side) (Tier 2)
- [x] GitHub Actions CI (Tier 1)
- [x] Optional: GraphQL (Tier 4)
- [x] RAG + embeddings + pgvector (breadth, not on the gap list but hot in 2026)
- [x] Multi-model LLM routing (breadth)

**Total gap-list items covered by this project: ~9,** with almost zero overlap with Habitat except Docker/CI/Sentry (which you *want* to do twice in different ecosystems).

---

## Core user stories (v1 scope)

1. **Ingestion**: user drops a file (photo, PDF, audio, screenshot) or pastes a URL into the web client, or shares to the mobile app via the iOS Share Sheet (later).
2. **Upload flow**:
   - Client requests a signed S3 upload URL from FastAPI.
   - Client uploads directly to S3.
   - S3 event notification → SQS → Celery → enqueue processing jobs.
3. **Processing**: async workers OCR, transcribe, embed, tag, and store metadata.
4. **Timeline view**: user sees a chronological feed of items, filterable by tag / date / source.
5. **Ask** (RAG chat): user asks a question of their history; the server retrieves top-K embedded items, passes them to Claude with the question, streams the answer with citations back.
6. **Weekly digest**: every Sunday, a scheduled Celery beat task generates a markdown recap and sends via SES.
7. **Export**: user can download all their data as a zip (JSON + files) — table stakes for a personal data product.

### Explicit non-goals for v1
- No multi-user / sharing. It's a single-user product for you first.
- No mobile app. Web + iOS Share Sheet via a PWA is enough.
- No end-to-end encryption. Assume you trust your own hosting.
- No monetization.

---

## Data model (SQLAlchemy sketch)

```py
# app/models.py

class User(Base):
    id: Mapped[UUID]
    email: Mapped[str]
    created_at: Mapped[datetime]
    settings: Mapped[dict]  # JSONB

class Item(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    kind: Mapped[Literal["photo","audio","pdf","screenshot","link","note"]]
    source: Mapped[str]                # "share", "upload", "email", ...
    s3_key: Mapped[Optional[str]]
    original_url: Mapped[Optional[str]]
    captured_at: Mapped[datetime]      # user's own time
    created_at: Mapped[datetime]       # ingestion time
    status: Mapped[Literal["pending","processing","done","failed"]]
    metadata: Mapped[dict]             # JSONB, per-kind

class Derivation(Base):
    """Anything a worker produced from an Item."""
    id: Mapped[UUID]
    item_id: Mapped[UUID]
    kind: Mapped[Literal["ocr_text","transcript","summary","thumbnail","dominant_color"]]
    text: Mapped[Optional[str]]
    data: Mapped[Optional[dict]]       # JSONB
    created_by_task: Mapped[str]       # Celery task name

class Tag(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    label: Mapped[str]
    color: Mapped[str]

class ItemTag(Base):
    item_id: Mapped[UUID]
    tag_id: Mapped[UUID]
    confidence: Mapped[float]          # auto-tagger confidence 0..1
    source: Mapped[Literal["user","auto"]]

class Embedding(Base):
    id: Mapped[UUID]
    item_id: Mapped[UUID]
    model: Mapped[str]                 # "openai/text-embedding-3-small"
    vector: Mapped[list[float]]        # pgvector column
    text: Mapped[str]                  # what was embedded (chunk)

class Digest(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    period_start: Mapped[date]
    period_end: Mapped[date]
    markdown: Mapped[str]
    sent_at: Mapped[Optional[datetime]]
    email_message_id: Mapped[Optional[str]]

class Query(Base):
    """RAG chat log for eval + debugging."""
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    question: Mapped[str]
    answer_md: Mapped[str]
    retrieved_item_ids: Mapped[list[UUID]]
    latency_ms: Mapped[int]
    created_at: Mapped[datetime]
```

Indexes to add:
- `items(user_id, captured_at DESC)`
- `items(user_id, status)`
- `derivations(item_id, kind)`
- `embeddings USING ivfflat (vector vector_cosine_ops)` (pgvector index — needed for fast K-NN)
- `item_tags(item_id)` + `item_tags(tag_id)`

---

## Architecture

```
                       +-------------------+
                       |  Next.js client   |
                       |  (timeline + ask) |
                       +---------+---------+
                                 | HTTPS (JWT from Auth.js)
                                 v
+------------------+     +------------------+     +--------+
|      S3          |<----|  FastAPI (app)   |---->| Sentry |
| (media bucket)   |     |  - REST + OpenAPI|     +--------+
+---------+--------+     |  - streams RAG   |
          |              +---+---+----------+
          | S3 event         |   |
          v                  |   v
+------------------+         |  +-----------+
| Lambda (thumbs)  |         |  |  RDS PG   |
+---------+--------+         |  |  +pgvector|
          |                  |  +-----------+
          v                  |
+------------------+   Redis |
|      SQS         |<--------+
|(ingestion queue) |         |
+---------+--------+         |
          |                  v
          v            +----------+
   +-------------+     |  Redis   |
   |  Celery     |<--->|  (broker)|
   |  workers    |     +----------+
   +------+------+
          |
     +----+----+------------+---------------+
     v         v            v               v
  OCR       Whisper     Embedder        Tagger
 (paddle/  (whisper-   (openai         (Claude
   easy)     cpp?)      SDK)            Haiku)

Terraform provisions: VPC, RDS, S3, SQS, SES, Lambda, IAM, Secrets Manager, ECS/EC2.
```

---

## Suggested folder layout (monorepo)

```
chronicle/
├── apps/
│   ├── api/                        FastAPI + Celery
│   │   ├── app/
│   │   │   ├── main.py             FastAPI app
│   │   │   ├── deps.py             DI (db session, current_user, s3 client)
│   │   │   ├── routers/
│   │   │   │   ├── items.py
│   │   │   │   ├── upload.py       signed-URL producer
│   │   │   │   ├── ask.py          RAG endpoint (SSE stream)
│   │   │   │   └── digests.py
│   │   │   ├── models.py           SQLAlchemy
│   │   │   ├── schemas.py          Pydantic
│   │   │   ├── tasks/              Celery tasks
│   │   │   │   ├── ocr.py
│   │   │   │   ├── transcribe.py
│   │   │   │   ├── embed.py
│   │   │   │   ├── tag.py
│   │   │   │   └── digest.py
│   │   │   ├── llm/
│   │   │   │   ├── client.py       Anthropic + OpenAI clients
│   │   │   │   ├── rag.py
│   │   │   │   └── prompts/
│   │   │   ├── s3.py
│   │   │   └── sentry.py
│   │   ├── alembic/                migrations
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── integration/        docker-compose'd db
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   └── web/                        Next.js 15
│       ├── app/
│       ├── components/
│       ├── lib/api.ts              typed client (openapi-generator)
│       └── package.json
├── infra/                          Terraform
│   ├── main.tf
│   ├── modules/
│   │   ├── rds/
│   │   ├── s3/
│   │   ├── sqs/
│   │   ├── ses/
│   │   ├── lambda-thumbnails/
│   │   └── ecs-service/
│   ├── envs/
│   │   ├── dev.tfvars
│   │   └── prod.tfvars
│   └── README.md
├── lambda/
│   └── thumbnail/                  small independently-deployable Lambda src
├── docker-compose.yml              api + postgres(pgvector) + redis + minio
├── .github/workflows/
│   ├── api.yml                     pytest + mypy + docker build
│   ├── web.yml                     typecheck + build
│   └── terraform.yml               fmt + validate + plan on PR; apply on dispatch
└── README.md
```

---

## Milestones (rough weekend-scale)

**Weekend 1 — v0 walking skeleton**
- FastAPI hello world in Docker, Postgres in Docker, alembic init.
- One endpoint: `POST /items` with a JSON note. Nothing async yet.
- pytest baseline; GH Actions runs pytest on PR.
- Sentry wired for the API.

**Weekend 2 — real ingestion pipeline**
- Add Redis + Celery.
- `POST /uploads/signed-url` returns S3 pre-signed URL (still local Minio at this point).
- S3 → SQS → Celery worker → OCR → save Derivation.
- Playwright-less; unit-test the tasks with pytest.

**Weekend 3 — embeddings + RAG**
- Add pgvector migration.
- Embed task after OCR/transcript.
- `/ask` endpoint: retrieves top-K, calls Claude, streams answer with citations via SSE.
- Small Next.js client (chat UI + timeline view) consumes it.

**Weekend 4 — infra + weekly digest**
- Terraform: RDS, real S3, SQS, SES, Secrets Manager, ECS or EC2, IAM.
- Deploy for real (`terraform apply` from `workflow_dispatch`).
- Celery beat scheduled task generates + SES-sends weekly digest.

**Weekend 5+ — polish**
- Lambda for thumbnails on S3 upload event (real S3 → Lambda gap).
- iOS Share Sheet (PWA target) or share-via-email inbox parser.
- Auto-tagging with Claude Haiku.
- Data export endpoint.

---

## Gotchas to know before you start

1. **pgvector needs the extension enabled**: `CREATE EXTENSION IF NOT EXISTS vector;` in your first Alembic migration. RDS PG supports it as a managed extension since PG 15.
2. **S3 event notifications → SQS**: this needs bucket policy + IAM on both sides. Terraform makes this bearable; hand-configuring in the console will melt your brain.
3. **Celery + FastAPI async**: Celery tasks are sync by default. Don't `asyncio.run()` from inside them if you can help it; use `run_in_executor`. Or use a native async queue (arq, taskiq) — modern alternative worth considering if you don't want the Celery config surface.
4. **Local S3**: use **Minio**; boto3 works against it with `endpoint_url` override.
5. **JWT from Next → FastAPI**: use Auth.js's JWT with a **shared secret**, verify in a FastAPI dependency. Don't try to do session cookies across the boundary — it's a rabbit hole.
6. **RDS cost**: even `db.t4g.micro` is ~$12/mo running 24/7. If you don't want that bill, use **Neon** for dev *and* prod (still Postgres, still SQL, cheap free tier) and only stand up RDS temporarily to demo the infra story.
7. **SES sandbox**: SES starts in sandbox mode — you can only send to verified addresses. Fine for a personal product; if you demo it, mention the sandbox → production request in the README.
8. **Terraform state**: use **S3 + DynamoDB lock** from day one, not local `terraform.tfstate`. Do it once in `infra/backend.tf` and forget about it.
9. **RAG quality**: chunk your OCR/transcripts on paragraph boundaries, not fixed-size. Fixed-size chunking is why bad RAG demos look bad.
10. **Sentry for Celery**: `sentry_sdk.integrations.celery.CeleryIntegration()` is one line; enable it or you'll be blind to task failures.

---

## What to intentionally NOT do

- Don't build a mobile app native. PWA + iOS Share Sheet does 95% of what you'd get.
- Don't add Kubernetes. ECS is enough of a story.
- Don't self-host Postgres. RDS or Neon.
- Don't run the LLM locally. API calls are cheaper than your time to configure a GPU.
- Don't add multi-tenancy. This is a single-user product; add it in v2 if you actually want to open-source it.

---

## Concrete first prompt for a fresh Claude Code session

> "I want to build Chronicle, a personal life-log with an async ingestion pipeline. Read `Chronicle.md` in this directory for the full brief. Start by scaffolding the `apps/api/` FastAPI project with Docker Compose (FastAPI + Postgres 16 with pgvector + Redis + Minio). Set up Alembic, the initial User + Item models, one `POST /items` endpoint accepting a JSON note, pytest baseline with one passing test, and the GitHub Actions workflow that runs pytest + mypy on PR. Do not add Celery, S3, or LLMs yet — I want a walking skeleton first."
