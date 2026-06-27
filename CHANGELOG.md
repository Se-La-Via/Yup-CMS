# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-06-27

### Added
- **Admin dashboard** for human oversight: a dependency-free web UI plus an
  admin API (separate process, `admin`-scoped API key). Review the approval
  queue and approve/reject, publish/unpublish/delete entries, inspect webhooks
  and their delivery log, and list assets. The public read API stays strictly
  read-only — admin writes are attributed to a human principal, so they satisfy
  the review gate. Configure with `CMS_ADMIN_PORT`.
- **Unique field constraints** — mark a field `unique` and duplicate values are
  rejected on create and update (best-effort, enforced in-transaction).

### Verified
- New CI smoke tests on real Postgres: the admin approval flow (`smoke:admin`,
  including auth gating) and unique constraints (`smoke:unique`).

## [0.1.0] — 2026-06-27

First public release. An agent-native headless CMS: AI agents write content
through MCP, websites read it over HTTP, and every change is attributed and
reversible.

### Core
- Content types as self-describing schemas; entries with an immutable revision
  history and full audit trail (revert supported).
- Rich field types — `text`, `richtext`, `number`, `boolean`, `date`, `json`,
  `select`, `reference` — with constraints: `required`, `default`, `options`,
  `min`/`max`, `pattern`.
- 25 MCP tools covering content, reviews, webhooks, assets, and API keys.

### Trust & security
- **Spoof-proof attribution**: write identity is bound to the MCP server's
  configured principal, never to request arguments.
- **Review gate**: an agent cannot publish approval-gated content or clear its
  own review — only a human/system principal can.
- API-key auth for the read API (published is public; non-published needs a
  `read:all` key; optional global lock).
- Per-IP rate limiting (token bucket) with `429` + `Retry-After`.

### Automation
- Events on every change with a **transactional outbox** (no lost/phantom
  events) and a delivery worker that retries with backoff. Signed (HMAC)
  webhook deliveries for n8n and other integrations, with a delivery log.

### Media
- Asset upload (inline base64 or fetched from a URL) and public serving.
- Pluggable storage: local filesystem and any S3-compatible store (AWS, MinIO,
  Cloudflare R2, Supabase Storage).

### Read API
- Read-only HTTP API for front-ends: list/get content by type and slug, fetch
  by id, expand `reference` fields, stream assets; permissive CORS.

### Operations
- One-command self-host via Docker Compose; interactive setup wizard.
- Reproducible installs with Drizzle migrations.
- CI on every push: typecheck, unit tests, production build, and integration
  tests (migrations, the end-to-end demo, the webhook pipeline, and assets on
  both local and S3/MinIO backends) against real services.

[0.2.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.2.0
[0.1.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.1.0
