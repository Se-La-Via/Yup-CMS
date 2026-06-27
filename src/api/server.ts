import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as read from "../core/read.js";
import * as content from "../core/content.js";
import * as auth from "../core/auth.js";
import * as assets from "../core/assets.js";
import { createLimiterFromEnv } from "../core/ratelimit.js";
import { executeGraphQL } from "../core/graphql.js";
import * as tenant from "../core/tenant.js";
import { NotFoundError, ValidationError } from "../core/content.js";

/**
 * Read-only HTTP API for front-ends.
 *
 *   GET /health
 *   GET /types                         list content types (schemas)
 *   GET /types/:name                   one content type
 *   GET /content/:type                 list entries (default published)
 *       ?status=&slug=&limit=&offset=&resolve=true
 *   GET /content/:type/:slug           one entry by slug
 *   GET /entries/:id                   one entry by id  (?resolve=true)
 *   GET /assets                        list asset metadata
 *   GET /assets/:id                    stream an asset's bytes
 *   GET /search?q=&type=              full-text search over entries
 *   POST /graphql                      GraphQL read queries
 *
 * Writes happen through the MCP server, never here — this surface only reads.
 */

const port = Number(process.env.CMS_API_PORT ?? 3000);
const VALID_STATUS = new Set([
  "draft",
  "scheduled",
  "pending_review",
  "published",
  "archived",
]);

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function rateLimited(req: IncomingMessage): Promise<{ retryAfter: number } | null> {
  if (!limiter) return null;
  const r = await limiter.check(clientKey(req), Date.now());
  return r.allowed ? null : { retryAfter: Math.ceil(r.retryAfterMs / 1000) };
}

/**
 * Which tenant this request reads from: the API key's tenant if authenticated,
 * else an explicit X-Tenant slug, else the default tenant.
 */
async function tenantFor(
  key: { tenantId: string } | null,
  req: IncomingMessage,
): Promise<string> {
  if (key) return key.tenantId;
  const slug = req.headers["x-tenant"] as string | undefined;
  if (slug) return tenant.resolveTenantId(slug);
  return tenant.DEFAULT_TENANT_ID;
}

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const limiter = createLimiterFromEnv();

/** Identify the caller for rate limiting: first proxied IP, else socket addr. */
function clientKey(req: import("node:http").IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const seg = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;

  if (req.method === "OPTIONS") return send(res, 204, {});

  // GraphQL read endpoint (POST). Read-only — queries only.
  if (req.method === "POST" && url.pathname === "/graphql") {
    const limited = await rateLimited(req);
    if (limited) {
      return send(res, 429, { error: "rate limit exceeded" }, {
        "retry-after": String(limited.retryAfter),
      });
    }
    const authz = req.headers.authorization;
    const token = authz?.startsWith("Bearer ")
      ? authz.slice(7)
      : (req.headers["x-api-key"] as string | undefined);
    const key = await auth.verifyKey(token);
    const tenantId = await tenantFor(key, req);
    const body = await readBody(req);
    if (typeof body.query !== "string") {
      return send(res, 400, { errors: [{ message: "missing 'query' string" }] });
    }
    const result = await executeGraphQL(
      body.query,
      body.variables as Record<string, unknown> | undefined,
      { key, tenantId },
    );
    return send(res, 200, result);
  }

  if (req.method !== "GET") {
    return send(res, 405, { error: "read-only API; only GET is supported" });
  }

  const resolve = q.get("resolve") === "true";
  const statusParam = q.get("status");
  if (statusParam && !VALID_STATUS.has(statusParam)) {
    return send(res, 400, {
      error: `invalid status "${statusParam}"`,
      valid: [...VALID_STATUS],
    });
  }
  const status = (statusParam ?? undefined) as read.Status | undefined;

  try {
    // /health — always open, no auth, no rate limit (for orchestrator probes).
    if (seg.length === 1 && seg[0] === "health") {
      return send(res, 200, { ok: true, service: "yup-cms", api: "read" });
    }

    // --- Rate limiting ----------------------------------------------------
    const limited = await rateLimited(req);
    if (limited) {
      return send(
        res,
        429,
        { error: "rate limit exceeded", retryAfterSeconds: limited.retryAfter },
        {
          "retry-after": String(limited.retryAfter),
          "x-ratelimit-limit": String(limiter!.limit),
          "x-ratelimit-remaining": "0",
        },
      );
    }

    // --- Authentication / authorization -----------------------------------
    // Published content is public by default. Reading anything non-published
    // (an explicit non-published status, or a by-id lookup that could return a
    // draft) requires an API key with the "read:all" scope. Set
    // CMS_REQUIRE_API_KEY=true to require a key for *every* read.
    const authz = req.headers.authorization;
    const token = authz?.startsWith("Bearer ")
      ? authz.slice(7)
      : (req.headers["x-api-key"] as string | undefined);
    const key = await auth.verifyKey(token);

    const wantsNonPublished =
      (statusParam != null && statusParam !== "published") || seg[0] === "entries";

    if (process.env.CMS_REQUIRE_API_KEY === "true" && !key) {
      return send(res, 401, { error: "a valid API key is required" });
    }
    if (wantsNonPublished) {
      if (!key) {
        return send(res, 401, {
          error: "an API key is required to read non-published content",
        });
      }
      if (!auth.hasScope(key, "read:all")) {
        return send(res, 403, { error: "this API key lacks the 'read:all' scope" });
      }
    }

    const tenantId = await tenantFor(key, req);

    // /types and /types/:name
    if (seg[0] === "types") {
      if (seg.length === 1) return send(res, 200, await content.listContentTypes(tenantId));
      if (seg.length === 2) return send(res, 200, await content.getContentType(seg[1]!, tenantId));
    }

    // /entries/:id
    if (seg[0] === "entries" && seg.length === 2) {
      return send(res, 200, await read.getById({ id: seg[1]!, resolve, tenantId }));
    }

    // /assets — list metadata; /assets/:id — stream the bytes
    if (seg[0] === "assets" && seg.length === 1) {
      return send(res, 200, await assets.listAssets(tenantId));
    }
    if (seg[0] === "assets" && seg.length === 2) {
      const { meta, bytes } = await assets.getAssetBytes(seg[1]!, tenantId);
      res.writeHead(200, {
        "content-type": meta.contentType,
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
      });
      res.end(bytes);
      return;
    }

    // /search?q=&type=&status=&limit=
    if (seg[0] === "search" && seg.length === 1) {
      const qstr = q.get("q");
      if (!qstr) return send(res, 400, { error: "?q= is required" });
      return send(
        res,
        200,
        await read.search({
          q: qstr,
          type: q.get("type") ?? undefined,
          status,
          limit: num(q.get("limit")),
          tenantId,
        }),
      );
    }

    // /content/:type and /content/:type/:slug
    if (seg[0] === "content" && seg.length === 2) {
      return send(
        res,
        200,
        await read.list({
          type: seg[1]!,
          status,
          slug: q.get("slug") ?? undefined,
          limit: num(q.get("limit")),
          offset: num(q.get("offset")),
          resolve,
          tenantId,
        }),
      );
    }
    if (seg[0] === "content" && seg.length === 3) {
      return send(
        res,
        200,
        await read.getBySlug({ type: seg[1]!, slug: seg[2]!, status, resolve, tenantId }),
      );
    }

    return send(res, 404, { error: "not found", path: url.pathname });
  } catch (e) {
    if (e instanceof NotFoundError) return send(res, 404, { error: e.message });
    if (e instanceof ValidationError) return send(res, 400, { error: e.message });
    return send(res, 500, { error: (e as Error).message });
  }
});

server.listen(port, () => {
  // stderr keeps stdout clean for any tooling that pipes it.
  console.error(`Yup CMS read API on http://localhost:${port}`);
});
