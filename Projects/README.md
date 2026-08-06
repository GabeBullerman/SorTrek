# Side-project briefs

Two stack-broadening side-project designs for Gabe. Each is self-contained
enough to hand to a fresh Claude Code session as context — the last section of
each brief includes a concrete first prompt to bootstrap the project.

## Index

| Brief | One-liner | Primary gaps closed |
|---|---|---|
| [Habitat.md](./Habitat.md) | Real-time focused-work session platform (Focusmate meets Discord, text-first) | Vitest, Playwright, GH Actions, Drizzle, TanStack Query, shadcn/ui, Storybook, Docker, Sentry, tRPC, WebSockets/realtime |
| [Chronicle.md](./Chronicle.md) | Personal life-log with async ingestion pipeline (Rewind.ai + Day One, self-hosted) | Python/FastAPI, SQLAlchemy, real AWS (S3/Lambda/SES/RDS), Terraform, Redis + Celery, Sentry (Python), pgvector/RAG |

## Overlap (intentional)

- **Docker** — different compose stacks in each project (Node/Postgres/Redis vs Python/Postgres+pgvector/Redis/Minio)
- **GitHub Actions CI** — different toolchains exercised (Vitest+Playwright vs pytest+mypy+terraform plan)
- **Sentry** — JS SDK in Habitat vs Python SDK + Celery integration in Chronicle
- **LLM calls** — different pattern (single-call recap vs multi-model routing + RAG)

Doing these three twice in different ecosystems is the point; it's not padding.

## What both projects deliberately skip

- Kubernetes (Tier 4 — DevOps roles only)
- Go / Rust (Tier 4 — add a small Project 3 later if desired: e.g., a Go CLI that queries Chronicle's API)
- NestJS (Tier 4 — enterprise Node)
- Mobile-native (both target responsive web / PWA)

## Suggested order

Build **Habitat first**. The realtime + type-safe-fullstack story is more portfolio-visible ("open two browser windows and watch presence sync" demos well). Chronicle is denser and lonelier — better once you already have the momentum of a shipped project.
