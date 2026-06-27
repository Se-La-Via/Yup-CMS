# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.6.0] — 2026-06-27

### Added
- **Signed marketplace packages** — a registry signs each item with an ed25519
  key (`npm run marketplace:keygen`); set `CMS_REGISTRY_PRIVATE_KEY` to sign on
  publish and `CMS_REGISTRY_PUBLIC_KEY` on installers to require a valid
  signature (tampered/unsigned installs are refused).
- **Remote registry sync** — a registry is just another Yup CMS; pull its
  catalog with `npm run marketplace:sync <url>`, `POST /api/marketplace/sync`, or
  the MCP `marketplace_sync` tool. Signatures are verified on import; forged
  items are skipped.

### Notes
- Migration `0007` adds a `signature` column to marketplace items (additive).

## [0.5.0] — 2026-06-27

Extensibility, a real editing UI, server-side rendering, and an admin copilot.

### Added
- **Plugin system** — extend the core without forking: custom field types,
  content lifecycle hooks (`beforeCreate`/`beforeUpdate`/`afterPublish`), and
  extra MCP tools. Loaded from `plugins.json` / `CMS_PLUGINS`; `npm run plugin:add`.
- **Marketplace** for plugins & themes — a registry with publish, public browse
  (`GET /marketplace`), one-click install from the admin, and MCP tools.
- **Full editing GUI** — the admin dashboard can now create and edit entries via
  forms generated from each content type's schema.
- **Themes & server-side rendering** — an optional render server turns published
  content into HTML pages; ships a safe `default` theme and a `rich` theme that
  renders richtext as HTML via a built-in safe Markdown renderer.
- **Admin copilot + insights** — an in-dashboard AI assistant (Claude) that
  drives the CMS through its tools as an *agent* (gated publishes go to review),
  plus a no-LLM insights panel. Enable with `ANTHROPIC_API_KEY`.

### Notes
- Migrations are additive. New optional services: `render` and `admin` (in
  docker-compose). The copilot is optional and degrades gracefully without a key.

## [0.4.0] — 2026-06-27

### Added
- **Full-text search** over entry content (Postgres FTS), tenant-scoped and
  published-by-default. Available on REST (`GET /search`), GraphQL (`search`),
  and MCP (`search_entries`).
- **Localized fields (i18n)** — mark a field `localized` to store a
  `{ locale: value }` map; reads flatten to a requested locale (`?locale=` /
  GraphQL `locale:`) with fallback to `CMS_DEFAULT_LOCALE` then any value.
- **Tenant-aware admin** — the dashboard shows the current tenant and lists
  tenants (`/api/whoami`, `/api/tenants`).
- **Per-key rate limiting** — authenticated callers are limited per API key (a
  per-tenant budget); anonymous callers per IP.
- **Demo dataset** — `npm run demo` populates a realistic instance (localized
  posts, authors via references, an asset, a webhook). New deploy guide in the
  README.

## [0.3.0] — 2026-06-27

### Added
- **Multi-tenancy** — every row belongs to a tenant (workspace) and every query
  is scoped to one; content, revisions, reviews, webhooks, assets, and API keys
  are isolated. A built-in `default` tenant keeps single-tenant installs
  config-free. Agents select a tenant with `CMS_TENANT`; the read API/GraphQL use
  the API key's tenant or an `X-Tenant` header. `create_tenant`/`list_tenants`
  tools. A CI test asserts cross-tenant isolation.
- **GraphQL read layer** at `POST /graphql` (queries only) alongside REST, with
  the same auth and rate limiting.
- **Scheduled publishing** — `schedule_publish`/`cancel_schedule`; the worker
  publishes entries when their time comes.
- **Distributed rate limiting** — `CMS_RATE_BACKEND=redis` for a shared limit
  across instances (atomic token bucket via a Redis Lua script).

### Notes
- Migrations are additive; `docker compose up -d --build` applies them. Existing
  data is assigned to the `default` tenant automatically.

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

[0.6.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.6.0
[0.5.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.5.0
[0.4.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.4.0
[0.3.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.3.0
[0.2.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.2.0
[0.1.0]: https://github.com/Se-La-Via/Yup-CMS/releases/tag/v0.1.0
