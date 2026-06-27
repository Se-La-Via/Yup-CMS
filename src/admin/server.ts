import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as content from "../core/content.js";
import * as events from "../core/events.js";
import * as assets from "../core/assets.js";
import * as auth from "../core/auth.js";
import * as tenantsvc from "../core/tenant.js";
import { getInsights } from "../core/insights.js";
import { runAssistant, AssistantNotConfiguredError } from "../core/assistant.js";
import { loadPlugins, enablePlugin } from "../core/plugins.js";
import * as marketplace from "../core/marketplace.js";
import { NotFoundError, ValidationError } from "../core/content.js";
import { DASHBOARD_HTML } from "./dashboard.js";

/**
 * Admin server — the human oversight surface. Unlike the public read API, this
 * one performs writes (approve reviews, publish, delete), so EVERY endpoint
 * requires an `admin`-scoped API key. Writes are attributed to a human principal
 * derived from the key, which is exactly what the review gate expects.
 *
 * Agents still go through MCP; this is for people.
 */

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

export function createAdminServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const seg = url.pathname.split("/").filter(Boolean);
    const q = url.searchParams;
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      return json(res, 204, {});
    }

    // The dashboard shell is public HTML; it asks for the key client-side.
    if (method === "GET" && seg.length === 0) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }
    if (method === "GET" && seg.length === 1 && seg[0] === "health") {
      return json(res, 200, { ok: true, service: "yup-cms", api: "admin" });
    }

    // Everything under /api requires an admin key.
    const authz = req.headers.authorization;
    const token = authz?.startsWith("Bearer ")
      ? authz.slice(7)
      : (req.headers["x-api-key"] as string | undefined);
    const key = await auth.verifyKey(token);
    if (!key) return json(res, 401, { error: "admin API key required" });
    if (!auth.hasScope(key, "admin")) {
      return json(res, 403, { error: "key lacks the 'admin' scope" });
    }
    const principal = { type: "human" as const, id: key.name };
    const tenantId = key.tenantId;

    if (seg[0] !== "api") return json(res, 404, { error: "not found" });
    const path = seg.slice(1);

    try {
      // --- reads ---
      if (method === "GET" && path[0] === "whoami") {
        const all = await tenantsvc.listTenants();
        const current = all.find((t) => t.id === tenantId);
        return json(res, 200, { key: key.name, tenantId, tenant: current?.slug ?? null });
      }
      if (method === "GET" && path[0] === "tenants") {
        return json(res, 200, await tenantsvc.listTenants());
      }
      if (method === "GET" && path[0] === "insights") {
        return json(res, 200, await getInsights(tenantId));
      }
      if (method === "GET" && path[0] === "marketplace") {
        return json(
          res,
          200,
          await marketplace.listItems({
            kind: (q.get("kind") as never) ?? undefined,
            q: q.get("q") ?? undefined,
          }),
        );
      }
      if (method === "POST" && path[0] === "assist") {
        const body = await readJsonBody(req);
        try {
          const result = await runAssistant({
            messages: (body.messages as never) ?? [],
            tenantId,
          });
          return json(res, 200, result);
        } catch (e) {
          if (e instanceof AssistantNotConfiguredError) {
            return json(res, 503, { error: e.message });
          }
          throw e;
        }
      }
      if (method === "GET" && path[0] === "types") {
        return json(res, 200, await content.listContentTypes(tenantId));
      }
      if (method === "GET" && path[0] === "entries" && path.length === 1) {
        const type = q.get("type");
        if (!type) return json(res, 400, { error: "?type= is required" });
        return json(
          res,
          200,
          await content.listEntries({
            type,
            status: (q.get("status") as never) ?? undefined,
            limit: 200,
            tenantId,
          }),
        );
      }
      if (method === "GET" && path[0] === "entries" && path.length === 2) {
        const entry = await content.getEntry(path[1]!, tenantId);
        const history = q.get("history") === "1"
          ? await content.getEntryHistory(path[1]!, tenantId)
          : undefined;
        return json(res, 200, { entry, history });
      }
      if (method === "GET" && path[0] === "reviews") {
        return json(
          res,
          200,
          await content.listReviews({ status: (q.get("status") as never) ?? undefined, tenantId }),
        );
      }
      if (method === "GET" && path[0] === "webhooks") {
        return json(res, 200, await events.listWebhooks(tenantId));
      }
      if (method === "GET" && path[0] === "deliveries") {
        return json(
          res,
          200,
          await events.getDeliveries({ webhookId: q.get("webhookId") ?? undefined, limit: 100, tenantId }),
        );
      }
      if (method === "GET" && path[0] === "assets") {
        return json(res, 200, await assets.listAssets(tenantId, 200));
      }

      // --- actions ---
      if (method === "POST" && path[0] === "marketplace" && path[1] === "install") {
        const body = await readJsonBody(req);
        const item = await marketplace.getItem(body.name as string);
        const plugins = await enablePlugin(item.specifier);
        return json(res, 200, {
          installed: true,
          name: item.name,
          specifier: item.specifier,
          plugins,
          note: "Restart the affected service to load it.",
        });
      }
      if (method === "POST" && path[0] === "marketplace" && path.length === 1) {
        const body = await readJsonBody(req);
        return json(res, 200, await marketplace.publishItem(body as never));
      }
      if (method === "POST" && path[0] === "types" && path.length === 1) {
        const body = await readJsonBody(req);
        return json(
          res,
          200,
          await content.createContentType({
            name: body.name as string,
            displayName: body.displayName as string,
            description: body.description as string | undefined,
            fields: (body.fields as never) ?? [],
            requireApproval: body.requireApproval as boolean | undefined,
            tenantId,
          }),
        );
      }
      if (method === "POST" && path[0] === "entries" && path.length === 1) {
        const body = await readJsonBody(req);
        return json(
          res,
          200,
          await content.createEntry({
            type: body.type as string,
            data: (body.data as Record<string, unknown>) ?? {},
            slug: body.slug as string | undefined,
            status: body.status as "draft" | "published" | undefined,
            author: principal,
            tenantId,
          }),
        );
      }
      if (method === "POST" && path[0] === "entries" && path.length === 2) {
        const body = await readJsonBody(req);
        return json(
          res,
          200,
          await content.updateEntry({
            id: path[1]!,
            data: (body.data as Record<string, unknown>) ?? {},
            author: principal,
            tenantId,
          }),
        );
      }
      if (method === "POST" && path[0] === "reviews" && path[2] === "approve") {
        const body = await readJsonBody(req);
        return json(
          res,
          200,
          await content.approveReview({
            requestId: path[1]!,
            author: principal,
            note: body.note as string | undefined,
            tenantId,
          }),
        );
      }
      if (method === "POST" && path[0] === "reviews" && path[2] === "reject") {
        const body = await readJsonBody(req);
        return json(
          res,
          200,
          await content.rejectReview({
            requestId: path[1]!,
            author: principal,
            note: body.note as string | undefined,
            tenantId,
          }),
        );
      }
      if (method === "POST" && path[0] === "entries" && path[2] === "status") {
        const body = await readJsonBody(req);
        return json(
          res,
          200,
          await content.setEntryStatus({
            id: path[1]!,
            status: body.status as never,
            author: principal,
            tenantId,
          }),
        );
      }
      if (method === "DELETE" && path[0] === "entries" && path.length === 2) {
        return json(res, 200, await content.deleteEntry({ id: path[1]!, author: principal, tenantId }));
      }

      return json(res, 404, { error: "not found", path: url.pathname });
    } catch (e) {
      if (e instanceof NotFoundError) return json(res, 404, { error: e.message });
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      return json(res, 500, { error: (e as Error).message });
    }
  });
}

// Boot when run directly (not when imported by a test).
if (process.argv[1] && /[/\\]admin[/\\]server\.(ts|js)$/.test(process.argv[1])) {
  const port = Number(process.env.CMS_ADMIN_PORT ?? 3001);
  loadPlugins().then(() => {
    createAdminServer().listen(port, () => {
      console.error(`Yup CMS admin on http://localhost:${port}`);
    });
  });
}
