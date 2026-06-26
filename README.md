# Yup CMS

> Agent-native headless CMS. A content backend that AI agents drive through MCP
> as naturally as a human clicks a mouse — with every change versioned and
> attributed to whoever (or whatever) made it.

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
      "env": { "DATABASE_URL": "postgres://yup:...@localhost:5432/yup" }
    }
  }
}
```

Then ask: *"List the content types in Yup, create a blog post about X, and
publish it."*

### Try the end-to-end demo

```bash
npm run seed   # defines a type, an agent writes + edits, a human publishes,
               # prints the audit trail, reverts — then demos the review gate
```

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
| `CMS_DEFAULT_AUTHOR_TYPE` / `CMS_DEFAULT_AUTHOR_ID` | `agent` / `yup-agent` | Author recorded when a write doesn't specify one. |

---

## Architecture

```
src/
  db/        schema.ts (7 tables) · client.ts · migrate via drizzle-orm
  core/      validation · content (writes+revisions) · events · read · auth
  mcp/       server.ts — 20 MCP tools (the write/control plane for agents)
  api/       server.ts — read-only HTTP API (the public surface)
  scripts/   setup (wizard) · migrate · seed (demo) · webhook-listener
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
| `set_entry_status` | publish / unpublish / archive |
| `get_entry_history` | full audit trail |
| `revert_entry` | restore a previous revision |
| `list_reviews` / `approve_review` / `reject_review` | the human approval queue (review gate) |
| `register_webhook` / `list_webhooks` / `delete_webhook` | manage event subscriptions |
| `get_webhook_deliveries` | inspect the delivery log (debug integrations) |
| `create_api_key` / `list_api_keys` / `revoke_api_key` | manage read-API keys |

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

Deliveries are best-effort and **never block or fail a content mutation**; every
attempt — success or failure, with HTTP status and latency — is recorded in
`webhook_deliveries` and readable via `get_webhook_deliveries`.

### Try it locally (no n8n needed)

```bash
# terminal 1 — a receiver that verifies the signature
npm run webhook:listen 4000 mysecret

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

Query params: `?status=` (default `published`), `?slug=`, `?limit=`, `?offset=`,
and `?resolve=true` to expand `reference` fields into the referenced published
entry. Responses are JSON with permissive CORS so a browser front-end can fetch
directly. The API is strictly read-only — non-GET returns `405`.

```bash
curl "http://localhost:3000/content/blog_post?status=published&resolve=true"
curl "http://localhost:3000/content/blog_post/hello-yup"
```

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

## Roadmap

- ✅ Webhooks / events for n8n and other automations.
- ✅ Review gate — human approval before an agent's draft goes live.
- ✅ REST read API with `reference` resolution.
- ✅ API keys for the read API.
- ✅ Docker Compose + setup wizard for easy self-hosting.
- GraphQL read layer alongside REST.
- Admin GUI (secondary interface) over the same core.
- Multi-tenant scoping & per-key rate limits.
- Write auth for remote (non-stdio) MCP.

## License

[MIT](LICENSE) © Se-La-Via
