/**
 * Theme system for the optional rendering layer. A theme turns content into HTML
 * pages (like a WordPress theme), while the CMS stays headless-first — rendering
 * is a separate, opt-in server.
 *
 * Themes are plain objects with render functions, registered by name. The
 * default theme below is intentionally minimal; custom themes ship as modules
 * (or plugins) that call `registerTheme` on import and are selected via
 * `CMS_THEME`.
 */

export interface RenderEntry {
  slug: string | null;
  data: Record<string, unknown>;
}

export interface IndexCtx {
  tenant: string;
  types: Array<{ name: string; displayName: string }>;
}
export interface ListCtx {
  tenant: string;
  type: string;
  entries: RenderEntry[];
}
export interface EntryCtx {
  tenant: string;
  type: string;
  entry: RenderEntry;
}

export interface Theme {
  name: string;
  renderIndex(ctx: IndexCtx): string;
  renderList(ctx: ListCtx): string;
  renderEntry(ctx: EntryCtx): string;
  renderNotFound(): string;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#222}
  a{color:#2456c7;text-decoration:none}a:hover{text-decoration:underline}
  h1{margin-bottom:.2em}.muted{color:#888}dt{font-weight:600;margin-top:.6em}
  ul{padding-left:1.1em}
</style></head><body>${body}
<footer class="muted" style="margin-top:3rem;border-top:1px solid #eee;padding-top:1rem">
Powered by Yup CMS</footer></body></html>`;
}

function title(entry: RenderEntry): string {
  const t = entry.data.title;
  return typeof t === "string" ? t : entry.slug ?? "(untitled)";
}

/** The built-in default theme. Escapes all values (safe for arbitrary content). */
export const defaultTheme: Theme = {
  name: "default",
  renderIndex(ctx) {
    const items = ctx.types
      .map((t) => `<li><a href="/${escapeHtml(t.name)}">${escapeHtml(t.displayName)}</a></li>`)
      .join("");
    return layout("Home", `<h1>Content</h1><ul>${items || "<li class=muted>No types</li>"}</ul>`);
  },
  renderList(ctx) {
    const items = ctx.entries
      .map(
        (e) =>
          `<li><a href="/${escapeHtml(ctx.type)}/${escapeHtml(e.slug ?? "")}">${escapeHtml(title(e))}</a></li>`,
      )
      .join("");
    return layout(
      ctx.type,
      `<p class=muted><a href="/">&larr; home</a></p><h1>${escapeHtml(ctx.type)}</h1><ul>${items || "<li class=muted>Nothing published</li>"}</ul>`,
    );
  },
  renderEntry(ctx) {
    const fields = Object.entries(ctx.entry.data)
      .filter(([k]) => k !== "title")
      .map(([k, v]) => {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
        return `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(val)}</dd>`;
      })
      .join("");
    return layout(
      title(ctx.entry),
      `<p class=muted><a href="/${escapeHtml(ctx.type)}">&larr; ${escapeHtml(ctx.type)}</a></p>` +
        `<h1>${escapeHtml(title(ctx.entry))}</h1><dl>${fields}</dl>`,
    );
  },
  renderNotFound() {
    return layout("Not found", `<h1>404</h1><p class=muted>Nothing here. <a href="/">Home</a></p>`);
  },
};

const themes = new Map<string, Theme>([["default", defaultTheme]]);

export function registerTheme(theme: Theme): void {
  themes.set(theme.name, theme);
}

export function getTheme(name?: string): Theme {
  return themes.get(name ?? "default") ?? defaultTheme;
}
