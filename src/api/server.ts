import "dotenv/config";
import { createServer, type ServerResponse } from "node:http";
import * as read from "../core/read.js";
import * as content from "../core/content.js";
import * as auth from "../core/auth.js";
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
 *
 * Writes happen through the MCP server, never here — this surface only reads.
 */

const port = Number(process.env.CMS_API_PORT ?? 3000);
const VALID_STATUS = new Set(["draft", "pending_review", "published", "archived"]);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const seg = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;

  if (req.method === "OPTIONS") return send(res, 204, {});
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
    // /health — always open, no auth.
    if (seg.length === 1 && seg[0] === "health") {
      return send(res, 200, { ok: true, service: "yup-cms", api: "read" });
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

    // /types and /types/:name
    if (seg[0] === "types") {
      if (seg.length === 1) return send(res, 200, await content.listContentTypes());
      if (seg.length === 2) return send(res, 200, await content.getContentType(seg[1]!));
    }

    // /entries/:id
    if (seg[0] === "entries" && seg.length === 2) {
      return send(res, 200, await read.getById({ id: seg[1]!, resolve }));
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
        }),
      );
    }
    if (seg[0] === "content" && seg.length === 3) {
      return send(
        res,
        200,
        await read.getBySlug({ type: seg[1]!, slug: seg[2]!, status, resolve }),
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
