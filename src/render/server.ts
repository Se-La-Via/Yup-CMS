import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as read from "../core/read.js";
import * as content from "../core/content.js";
import * as tenant from "../core/tenant.js";
import { loadPlugins } from "../core/plugins.js";
import { getTheme } from "./theme.js";

/**
 * Optional rendering server — turns published content into HTML pages using a
 * theme. The CMS stays headless-first; run this only if you want server-rendered
 * pages.
 *
 *   GET /                 index of content types
 *   GET /:type            list of published entries
 *   GET /:type/:slug      a single entry
 *
 * Tenant comes from the X-Tenant header, else CMS_RENDER_TENANT, else default.
 * Theme is selected by CMS_THEME (default "default"). `?locale=` localizes.
 */

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

async function resolveTenant(req: IncomingMessage): Promise<string> {
  const slug =
    (req.headers["x-tenant"] as string | undefined) ??
    process.env.CMS_RENDER_TENANT ??
    tenant.DEFAULT_TENANT_SLUG;
  return tenant.resolveTenantId(slug);
}

export function createRenderServer() {
  return createServer(async (req, res) => {
    const theme = getTheme(process.env.CMS_THEME);
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const seg = url.pathname.split("/").filter(Boolean);
      const locale = url.searchParams.get("locale") ?? undefined;
      const tenantId = await resolveTenant(req);

      if (req.method !== "GET") {
        return html(res, 405, theme.renderNotFound());
      }

      if (seg.length === 0) {
        const types = await content.listContentTypes(tenantId);
        return html(res, 200, theme.renderIndex({
          tenant: tenantId,
          types: types.map((t) => ({ name: t.name, displayName: t.displayName })),
        }));
      }

      if (seg.length === 1) {
        const type = await content.getContentType(seg[0]!, tenantId);
        const entries = await read.list({
          type: seg[0]!,
          status: "published",
          limit: 100,
          resolve: true,
          locale,
          tenantId,
        });
        return html(res, 200, theme.renderList({
          tenant: tenantId,
          type: seg[0]!,
          entries: entries.map((e) => ({ slug: e.slug, data: e.data })),
          fields: type.fields,
        }));
      }

      if (seg.length === 2) {
        const type = await content.getContentType(seg[0]!, tenantId);
        const entry = await read.getBySlug({
          type: seg[0]!,
          slug: seg[1]!,
          status: "published",
          resolve: true,
          locale,
          tenantId,
        });
        return html(res, 200, theme.renderEntry({
          tenant: tenantId,
          type: seg[0]!,
          entry: { slug: entry.slug, data: entry.data },
          fields: type.fields,
        }));
      }

      return html(res, 404, theme.renderNotFound());
    } catch {
      // Unknown type/slug/tenant → 404 page (don't leak internals).
      return html(res, 404, theme.renderNotFound());
    }
  });
}

if (process.argv[1] && /[/\\]render[/\\]server\.(ts|js)$/.test(process.argv[1])) {
  const port = Number(process.env.CMS_RENDER_PORT ?? 3002);
  loadPlugins().then(() => {
    createRenderServer().listen(port, () => {
      console.error(`Yup CMS render server on http://localhost:${port} (theme: ${process.env.CMS_THEME ?? "default"})`);
    });
  });
}
