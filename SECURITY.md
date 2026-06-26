# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **Security → Report a
vulnerability** (private advisory) on this repository, rather than opening a
public issue. We aim to acknowledge reports within a few days.

## Trust model (what the design guarantees)

Yup CMS is built so that AI agents can write content safely:

- **Identity is bound to the connection, not the request.** The MCP server acts
  as a fixed principal (`CMS_PRINCIPAL_TYPE` / `CMS_PRINCIPAL_ID`); write tools
  have no `author` argument, so a caller cannot forge who made a change.
- **The review gate is unbypassable by agents.** An `agent` principal cannot
  publish approval-gated content directly, and cannot approve or reject its own
  reviews — only a `human`/`system` principal can.
- **Every change is auditable.** All mutations append an immutable revision with
  the attributed principal.

## Operational notes

- The read API is **public for published content by default**. Lock it down with
  `CMS_REQUIRE_API_KEY=true`, and use `read:all`-scoped keys for non-published
  reads. Always set a strong `POSTGRES_PASSWORD`.
- The MCP server is the trusted control plane (it holds DB credentials). Only
  expose it to principals you trust, and give human reviewers a separate
  `CMS_PRINCIPAL_TYPE=human` connection.
- Put the read API behind TLS and a rate limiter before exposing it publicly
  (rate limiting is on the roadmap, not yet built in).
