# Yup CMS

> Agent-native headless CMS. A content backend that AI agents drive through MCP
> as naturally as a human clicks a mouse — with every change versioned and
> attributed to whoever (or whatever) made it.

[![CI](https://github.com/Se-La-Via/Yup-CMS/actions/workflows/ci.yml/badge.svg)](https://github.com/Se-La-Via/Yup-CMS/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why this exists

Every CMS today (even headless ones like Strapi or Payload) is designed around a
human with a GUI; the API is bolted on. Yup CMS flips the priority: the **primary
interface is an MCP server for agents**, and a GUI is secondary. Because content
is driven by autonomous agents, three things are first-class from day one:

- **Self-describing schemas** — an agent can ask "what content types exist and
  what fields do they have?" and get a machine-readable answer.
- **Attribution** — every mutation records whether a *human* or an *agent* made
  it, who specifically, and why.
- **Reversibility** — every create/update/publish appends an immutable revision;
  any entry can be reverted.

---

## Install

### Option A — Docker Compose (recommended)

The fastest way to self-host on any server with Docker. Brings up Postgres,
applies migrations, and starts the read API — one command.

```bash
git clone https://github.com/Se-La-Via/Yup-CMS.git
cd Yup-CMS

cp .env.example .env        # then edit POSTGRES_PASSWORD, etc.
#   — or run the interactive wizard instead of editing by hand:
#   npm install && npm run setup

docker compose up -d
```

That's it. The read API is on `http://localhost:3000` (`GET /health` to check).
Postgres data persists in the `yup_pgdata` volume. To update:

```bash
git pull && docker compose up -d --build
```

### Option B — Node on the host

For development or if you already run Postgres elsewhere (e.g. a managed DB).

```bash
git clone https://github.com/Se-La-Via/Yup-CMS.git
cd Yup-CMS
npm install
npm run setup          # interactive: writes .env, can migrate + mint an admin key
npm run db:migrate     # if you didn't let the wizard do it
npm run api            # start the read API
```

> **Configure it for you.** `npm run setup` is the wizard: it asks for your DB
> credentials, default author identity, API port, and whether to lock down reads,
> then writes a `.env`. Re-runnable; it asks before overwriting. Prefer files?
> Everything it sets is documented in [`.env.example`](.env.example).

### Connecting an AI agent (MCP)

Point any MCP client (Claude Code, Claude Desktop, etc.) at the MCP server:

```json
{
  "mcpServers": {
    "yup": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/path/to/Yup-CMS",
      "env": {
        "DATABASE_URL": "postgres://yup:...@localhost:5432/yup",
        "CMS_PRINCIPAL_TYPE": "agent",
        "CMS_PRINCIPAL_ID": "claude"
      }
    }
  }
}
```

The `CMS_PRINCIPAL_*` values bind this connection's identity (see
[Trust model](#trust-model)). An agent connection is held by the review gate; a
human reviewer connects with `CMS_PRINCIPAL_TYPE=human`.

Then ask: *"List the content types in Yup, create a blog post about X, and
publish it."*

### Try the end-to-end demo

```bash
npm run seed   # defines a type, an agent writes + edits, a human publishes,
               # prints the audit trail, reverts — then demos the review gate
npm run demo   # populates a realistic dataset: localized posts, authors
               # (references), an asset, and a webhook — so the install looks alive
```

### Deploying to a server

Docker Compose runs anywhere Docker does (a VPS, etc.). For production:

1. Set strong secrets in `.env` (`POSTGRES_PASSWORD`); consider a managed
   Postgres and point `DATABASE_URL` at it.
2. Put the read API and admin behind a TLS-terminating reverse proxy (nginx,
   Caddy, Traefik). Expose the read API publicly; keep the admin port private or
   behind auth at the proxy.
3. `CMS_REQUIRE_API_KEY=true` if even published reads should require a key; set
   `CMS_RATE_BACKEND=redis` (+ a Redis service) when running multiple instances.
4. `docker compose up -d --build`; migrations run automatically. Run `npm run demo`
   once to seed sample content if you want.

---

## Configuration

All configuration is environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | Postgres connection (host tools). Compose sets the container's automatically. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `yup` | Provision the bundled Postgres (compose). |
| `POSTGRES_PORT` | `5432` | Host port Postgres is exposed on. |
| `CMS_API_PORT` | `3000` | Read API port. |
| `CMS_REQUIRE_API_KEY` | `false` | Require a key for **every** read (else only non-published). |
| `CMS_PRINCIPAL_TYPE` / `CMS_PRINCIPAL_ID` | `agent` / `yup-agent` | Trusted identity the MCP server writes as. Stamped on every change; **not** taken from request args (see Trust model). |

---

## Architecture

```
src/
  db/        schema.ts (7 tables) · client.ts · migrate via drizzle-orm
  core/      validation · content (writes+revisions) · events (outbox+worker)
             · policy · backoff · read · graphql · ratelimit · auth · assets · storage
  mcp/       server.ts — 30 MCP tools (the write/control plane for agents)
  api/       server.ts — read-only HTTP API + asset serving (the public surface)
  admin/     server.ts + dashboard — human admin UI + admin API (oversight)
  plugins/   plugin system + bundled example plugins
  render/    optional theme-based HTML rendering server
  scripts/   setup · migrate · worker · seed · smoke-{webhooks,assets,admin} · webhook-listener
drizzle/     SQL migrations (reproducible installs)
Dockerfile · docker-compose.yml
```

### MCP tools

| Tool | Purpose |
|------|---------|
| `list_content_types` / `get_content_type` | discover schemas |
| `create_content_type` | define a new schema |
| `list_entries` / `get_entry` | read content |
| `create_entry` / `update_entry` | write content (partial updates) |
| `delete_entry` | permanently delete an entry (hard delete) |
| `set_entry_status` | publish / unpublish / archive |
| `schedule_publish` / `cancel_schedule` | publish automatically at a future time |
| `get_entry_history` | full audit trail |
| `revert_entry` | restore a previous revision |
| `list_reviews` / `approve_review` / `reject_review` | the human approval queue (review gate) |
| `register_webhook` / `list_webhooks` / `delete_webhook` | manage event subscriptions |
| `get_webhook_deliveries` | inspect the delivery log (debug integrations) |
| `create_api_key` / `list_api_keys` / `revoke_api_key` | manage read-API keys |
| `upload_asset` / `list_assets` / `get_asset` / `delete_asset` | manage media/assets |

### Field types

A content type's fields can be `text`, `richtext`, `number`, `boolean`, `date`,
`json`, `select`, or `reference`. Each field supports optional constraints,
validated on every write:

- `required` — must be present
- `default` — value applied on create when omitted
- `options` — allowed values (required for `select`)
- `min` / `max` — numeric range, or string length for `text`/`richtext`
- `pattern` — regex a `text`/`richtext` value must match
- `unique` — value must be unique among entries of the type
- `localized` — store a `{ locale: value }` map; reads flatten it to a locale
- `refType` — target content type for a `reference`

Localized reads take `?locale=` (REST) or a `locale:` arg (GraphQL); a missing
locale falls back to `CMS_DEFAULT_LOCALE` (default `en`), then any available value.

## Review gate (agents propose, humans dispose)

Mark a content type with `requireApproval: true` and the trust boundary turns on:
when an **agent** tries to publish an entry of that type, it does **not** go live —
the entry moves to `pending_review` and a request lands in the approval queue.
A **human** then `approve_review` (→ published) or `reject_review` (→ back to draft).
Humans publishing directly bypass the gate — they *are* the approval.

This is deliberately keyed on author attribution (`human` vs `agent`), so the same
mechanism that records *who* changed content also decides *who may ship it*. It
emits `entry.review_requested`, `review.approved`, and `review.rejected` events,
so an approval can itself kick off downstream automation.

## Themes & rendering (optional)

Yup CMS is headless-first, but it can also **render HTML pages** itself — run
`npm run render` (default port 3002, or the `render` compose service):

```
GET /              index of content types
GET /:type         list of published entries
GET /:type/:slug   a single entry      (?locale= to localize)
```

Pages are produced by a **theme** (`CMS_THEME`, default `default`). A theme is a
module with `renderIndex` / `renderList` / `renderEntry` functions; custom themes
register themselves on load (and can ship as plugins). The render server reads
only published content, resolves references, and is fully optional — your own
front-end consuming the REST/GraphQL API remains first-class.

## Plugins (extend the core)

Yup CMS is extensible without forking. A **plugin** is a module that contributes:

- **custom field types** (with validation) — e.g. `email`, `color`;
- **content lifecycle hooks** — `beforeCreate` / `beforeUpdate` (transform data)
  and `afterPublish` (react);
- **extra MCP tools** for agents.

```ts
import { definePlugin } from "yup-cms/plugins";

export default definePlugin({
  name: "reading-time",
  hooks: {
    beforeCreate: ({ data }) => ({ ...data, reading_time: estimate(data.body) }),
  },
});
```

Enable plugins by listing module specifiers in `plugins.json` (see
[`plugins.example.json`](plugins.example.json)) or the `CMS_PLUGINS` env, or add
one with `npm run plugin:add <package>`. They load at server startup. Two example
plugins ship in `src/plugins/examples/`.

For **no-code** extensions, the webhook/event system already lets external
services (n8n, functions) react to changes — no plugin code needed.

> Plugins run in-process and are trusted in a self-hosted deployment. A signed
> plugin **marketplace** (discovery + install) is the natural next layer on top of
> this manifest format.

## Multi-tenancy

Every row belongs to a **tenant** (workspace), and every query is scoped to one —
content, revisions, reviews, webhooks, assets, and API keys are all isolated. A
built-in `default` tenant means single-tenant installs need no configuration.

- **Agents:** point an MCP connection at a tenant with `CMS_TENANT=<slug>`; all
  its operations are confined to that tenant. Create tenants with the
  `create_tenant` tool.
- **Read API / GraphQL:** the tenant comes from the API key's tenant, or an
  `X-Tenant: <slug>` header for anonymous published reads, else `default`.
- **Admin:** scoped to the admin key's tenant.

Isolation is covered by a dedicated CI test that asserts one tenant cannot see
another's data through any surface.

## Trust model

Attribution is only meaningful if it can't be forged, so identity is bound to the
**connection**, not to request arguments:

- The MCP server runs with a fixed principal (`CMS_PRINCIPAL_TYPE` / `_ID`). Every
  write it performs is stamped with that identity — tools have **no** `author`
  argument to override it.
- An **agent** principal is subject to the review gate and **cannot approve or
  reject reviews**. A human reviewer therefore connects through a separate MCP
  server configured with `CMS_PRINCIPAL_TYPE=human`.
- The read API holds no write authority; it is guarded separately by API keys.

The upshot: an agent cannot publish gated content, cannot clear its own review,
and cannot write a change into the audit trail under someone else's name.

## Scheduled publishing

Schedule an entry to go live later with `schedule_publish(id, publishAt)` (ISO
8601). The entry moves to a `scheduled` status, and the **worker** publishes it
once the time passes — emitting `entry.published` like any other publish, so
downstream automations fire normally. `cancel_schedule` returns it to draft.
Agents cannot schedule approval-gated types (same rule as the review gate). The
worker must be running (it's the `worker` service in docker-compose).

## Events & automation (n8n)

Yup CMS emits an event on every meaningful change, turning it into a node in an
automation graph. Subscribers (an n8n Webhook node, a serverless function,
anything that takes an HTTP POST) register a URL and receive signed deliveries.

**Event types:** `entry.created`, `entry.updated`, `entry.published`,
`entry.unpublished`, `entry.archived`, `entry.reverted`, `entry.review_requested`,
`review.approved`, `review.rejected`, `type.created`.

Each delivery is a `POST` with JSON body `{ event, timestamp, data }` and headers:

- `X-Yup-Event` — the event type
- `X-Yup-Signature` — `sha256=<hmac>` of the body (when the webhook has a
  secret), so the receiver can verify authenticity

**Reliable by design (transactional outbox).** When a change commits, its event
is written to an `event_outbox` table **in the same transaction** — so the event
is recorded if and only if the change is saved, even if the process crashes a
moment later. A separate **worker** (`npm run worker`, or the `worker` service in
docker-compose) fans events out and delivers them, **retrying with backoff**
(10s → 30s → 2m → 10m → 30m) until success or the attempt budget is exhausted.
Delivery never blocks or fails the originating write. Every attempt — status,
HTTP code, latency, attempt count — is recorded in `webhook_deliveries` and
readable via `get_webhook_deliveries`.

> The worker must be running for webhooks to be delivered. `docker compose up`
> starts it automatically.

### Try it locally (no n8n needed)

```bash
# terminal 1 — a receiver that verifies the signature
npm run webhook:listen 4000 mysecret

# terminal 2 — the delivery worker
npm run worker

# then register a hook (via the MCP tool) pointing at it:
#   register_webhook { name: "local", url: "http://localhost:4000", secret: "mysecret" }
# every create/update/publish now shows up in terminal 1.
```

## Read API (for front-ends)

Agents *write* through MCP; websites and apps *read* through a plain HTTP API.

| Route | Returns |
|-------|---------|
| `GET /health` | liveness check |
| `GET /types` · `GET /types/:name` | content type schemas |
| `GET /content/:type` | entries of a type — **published by default** |
| `GET /content/:type/:slug` | one entry by slug |
| `GET /entries/:id` | one entry by id |
| `GET /search?q=&type=` | full-text search over entries |

Query params: `?status=` (default `published`), `?slug=`, `?limit=`, `?offset=`,
and `?resolve=true` to expand `reference` fields into the referenced published
entry. Responses are JSON with permissive CORS so a browser front-end can fetch
directly. The API is strictly read-only — non-GET returns `405`.

```bash
curl "http://localhost:3000/content/blog_post?status=published&resolve=true"
curl "http://localhost:3000/content/blog_post/hello-yup"
```

### GraphQL

A read-only GraphQL endpoint is available at `POST /graphql` for front-ends that
prefer typed queries over REST. Same trust rules apply (published is public;
non-published needs a `read:all` key) and the same rate limit.

```graphql
{
  entries(type: "blog_post", status: "published", limit: 10) {
    id slug status data
  }
  contentType(name: "blog_post") { displayName fields }
}
```

Queries: `contentTypes`, `contentType`, `entries`, `entry`, `entryBySlug`,
`assets`. Dynamic per-type fields are exposed via a `JSON` scalar (`data`,
`fields`). It's strictly read-only — there are no mutations (writes go through MCP).

### Authentication

Published content is **public by default** — that is the point of a website.
Privileged reads are guarded by API keys:

- Reading **non-published** content — an explicit `?status=draft|pending_review|archived`,
  or any `/entries/:id` lookup (which could return a draft) — requires a key with
  the **`read:all`** scope.
- Set `CMS_REQUIRE_API_KEY=true` to require a valid key for **every** read.
- `/health` is always open.

Pass the key as `Authorization: Bearer <key>` or `X-API-Key: <key>`. Keys are
minted through the MCP tool `create_api_key` (the raw key is shown once and only
the SHA-256 hash is stored). Scopes: `read:published`, `read:all`, `admin`.

```bash
curl -H "Authorization: Bearer yup_..." \
  "http://localhost:3000/content/blog_post?status=draft"
```

> The MCP server is the trusted control plane (it holds the DB credentials), so
> key administration and content writes go through it. The read API is the
> untrusted public surface, which is what keys protect.

### Rate limiting

The read API is rate-limited with a token bucket — **per API key** when
authenticated (so each key/tenant gets its own budget), else per client IP
(default **120 requests / 60s**; tune with `CMS_RATE_LIMIT` and `CMS_RATE_WINDOW_MS`, or set
`CMS_RATE_LIMIT=0` to disable). Over the limit returns `429` with a `Retry-After`
header; `/health` is exempt. By default the limiter is per-process; set
`CMS_RATE_BACKEND=redis` with `CMS_REDIS_URL` for a **single shared limit across
a horizontally-scaled fleet** (atomic token bucket via a Redis Lua script).

## Admin dashboard (for humans)

Agents work through MCP; people get a browser UI. Run `npm run admin` (default
port 3001, or the `admin` service in docker-compose) and open it. The dashboard
is a single dependency-free page where a human reviewer can:

- see the **pending review queue** and **approve/reject** — the key
  human-in-the-loop action behind the review gate;
- **create and edit entries** with forms generated from the content type's
  fields, and **publish/unpublish/delete** them;
- inspect webhooks and their delivery log, list assets, and view tenants.

Every admin action requires an **`admin`-scoped API key** (mint one with the MCP
tool `create_api_key`); the dashboard prompts for it and stores it locally. The
admin server is a **separate process** from the public read API, so that surface
stays strictly read-only — writes only ever happen through MCP or this
authenticated admin API. Admin writes are attributed to a human principal, so
they satisfy the review gate.

## Media & assets

Upload files through the MCP tool `upload_asset` — either inline base64 or by
giving a `sourceUrl` for the server to fetch (handy when an agent generates an
image elsewhere). Metadata (filename, MIME type, size, SHA-256) is stored in
Postgres; the bytes go to a pluggable storage backend. Serve them publicly:

```
GET /assets          → list metadata
GET /assets/:id      → stream the bytes (correct Content-Type, long cache)
```

Storage backends are configured with `CMS_STORAGE_BACKEND`:

- **`local`** (default) — files under `CMS_STORAGE_DIR`. Simplest; the uploader
  (MCP) and the read API must share that directory (one host or one volume).
- **`s3`** — any S3-compatible store (AWS S3, MinIO, Cloudflare R2, Supabase
  Storage). Set `CMS_S3_BUCKET`/`CMS_S3_REGION`, optionally `CMS_S3_ENDPOINT` +
  `CMS_S3_FORCE_PATH_STYLE=true` for non-AWS, and credentials (or rely on the
  IAM default chain). This removes the shared-directory constraint, so it's the
  choice for multi-host/serverless. See [`.env.example`](.env.example).

`CMS_MAX_ASSET_BYTES` caps upload size. Both backends are exercised in CI
(S3 against a MinIO service).

## Roadmap

- ✅ Webhooks / events for n8n and other automations.
- ✅ Review gate — human approval before an agent's draft goes live.
- ✅ REST read API with `reference` resolution.
- ✅ API keys for the read API.
- ✅ Docker Compose + setup wizard for easy self-hosting.
- ✅ Spoof-proof attribution & unbypassable review gate (connection-bound principal).
- ✅ CI (typecheck · tests · build · migrations + webhook smoke test on real Postgres), DB indexes, production image.
- ✅ Reliable webhook delivery — transactional outbox + worker with retries/backoff.
- ✅ Rich field types & validation (select, defaults, min/max, regex) + `delete_entry`.
- ✅ Media / asset handling (upload + serve; pluggable storage).
- ✅ S3-compatible storage backend (local + S3, both CI-tested).
- ✅ Rate limiting on the read API (token bucket, per IP).
- ✅ Admin dashboard for human oversight (review queue, publish, webhooks, assets).
- ✅ Unique field constraints.
- ✅ GraphQL read layer alongside REST.
- ✅ Scheduled publishing (publish at a future time via the worker).
- ✅ Distributed (Redis-backed) rate limiting for multi-instance deployments.
- ✅ Multi-tenancy — isolated workspaces across every surface.
- ✅ Plugin system — custom field types, lifecycle hooks, and MCP tools.
- ✅ Themes & server-side rendering (optional HTML pages) + full editing GUI.
- Plugin marketplace (signed discovery + install) on top of the manifest format.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security policy: [SECURITY.md](SECURITY.md).
Release history: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Se-La-Via
