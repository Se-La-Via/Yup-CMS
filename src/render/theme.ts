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

import type { FieldDef } from "../db/schema.js";
import { renderMarkdown } from "./markdown.js";

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
  fields?: FieldDef[];
}
export interface EntryCtx {
  tenant: string;
  type: string;
  entry: RenderEntry;
  fields?: FieldDef[];
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

function layout(title: string, body: string, rich = false): string {
  const richCss = rich
    ? `
  article{font-size:1.05rem}
  article h1{font-size:2rem;line-height:1.15}
  article h2{margin-top:1.6em}
  article img{max-width:100%;height:auto;border-radius:8px}
  article pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}
  article code{background:#f0f1f3;padding:1px 4px;border-radius:4px}
  article pre code{background:none;padding:0}
  article blockquote{border-left:3px solid #d0d7de;margin:1em 0;padding-left:1em;color:#555}
  .label{font-weight:600;color:#555}
  ul.cards{list-style:none;padding:0}ul.cards li{padding:.5em 0;border-bottom:1px solid #eee}`
    : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#222}
  a{color:#2456c7;text-decoration:none}a:hover{text-decoration:underline}
  h1{margin-bottom:.2em}.muted{color:#888}dt{font-weight:600;margin-top:.6em}
  ul{padding-left:1.1em}${richCss}
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

/**
 * Richer theme: renders each field according to its type — richtext as HTML
 * (via the safe Markdown renderer), dates/booleans/references nicely, JSON in a
 * code block. Select with `CMS_THEME=rich`.
 */
function renderFieldValue(field: FieldDef | undefined, value: unknown): string {
  if (value === null || value === undefined) return "";
  const type = field?.type;
  if (type === "richtext") return renderMarkdown(String(value));
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "json")
    return `<pre><code>${escapeHtml(JSON.stringify(value, null, 2))}</code></pre>`;
  if (type === "reference" && typeof value === "object") {
    const ref = value as { data?: { title?: unknown }; id?: unknown };
    return escapeHtml(String(ref.data?.title ?? ref.id ?? ""));
  }
  return escapeHtml(String(value));
}

export const richTheme: Theme = {
  name: "rich",
  renderIndex: defaultTheme.renderIndex,
  renderList(ctx) {
    const items = ctx.entries
      .map((e) => {
        const t =
          typeof e.data.title === "string" ? e.data.title : (e.slug ?? "(untitled)");
        return `<li><a href="/${escapeHtml(ctx.type)}/${escapeHtml(e.slug ?? "")}">${escapeHtml(t)}</a></li>`;
      })
      .join("");
    return layout(
      ctx.type,
      `<p class=muted><a href="/">&larr; home</a></p><h1>${escapeHtml(ctx.type)}</h1><ul class="cards">${items || "<li class=muted>Nothing published</li>"}</ul>`,
      true,
    );
  },
  renderEntry(ctx) {
    const data = ctx.entry.data;
    const titleVal = typeof data.title === "string" ? data.title : (ctx.entry.slug ?? "(untitled)");
    const byName = new Map((ctx.fields ?? []).map((f) => [f.name, f]));

    // Render declared fields in schema order; fall back to data keys.
    const keys = ctx.fields?.length ? ctx.fields.map((f) => f.name) : Object.keys(data);
    const body = keys
      .filter((k) => k !== "title" && data[k] !== undefined && data[k] !== null)
      .map((k) => {
        const rendered = renderFieldValue(byName.get(k), data[k]);
        const isRich = byName.get(k)?.type === "richtext" || byName.get(k)?.type === "json";
        return isRich
          ? `<section>${rendered}</section>`
          : `<p><span class="label">${escapeHtml(k)}:</span> ${rendered}</p>`;
      })
      .join("\n");

    return layout(
      String(titleVal),
      `<p class=muted><a href="/${escapeHtml(ctx.type)}">&larr; ${escapeHtml(ctx.type)}</a></p>` +
        `<article><h1>${escapeHtml(String(titleVal))}</h1>${body}</article>`,
      true,
    );
  },
  renderNotFound: defaultTheme.renderNotFound,
};

const themes = new Map<string, Theme>([
  ["default", defaultTheme],
  ["rich", richTheme],
]);

export function registerTheme(theme: Theme): void {
  themes.set(theme.name, theme);
}

export function getTheme(name?: string): Theme {
  return themes.get(name ?? "default") ?? defaultTheme;
}
