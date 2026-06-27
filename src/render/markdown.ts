/**
 * Minimal, safe Markdown → HTML renderer for richtext fields.
 *
 * Safety: the source is HTML-escaped FIRST, so any raw HTML (including
 * `<script>`) becomes inert text. Markdown syntax is then turned into a small,
 * fixed set of tags we emit ourselves. Link hrefs are allow-listed. No
 * dependency, no `dangerouslySetInnerHTML` of arbitrary input.
 *
 * Supported: headings, bold, italic, inline code, fenced code blocks, links,
 * unordered/ordered lists, and paragraphs. Anything else renders as text.
 */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function safeHref(url: string): string | null {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

/** Inline formatting on already-escaped text. */
function inline(text: string): string {
  let out = text;
  // Inline code first so its contents aren't further formatted.
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // Links [text](url) — drop the link if the href isn't allow-listed.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const href = safeHref(url);
    return href ? `<a href="${esc(href)}">${label}</a>` : label;
  });
  // Bold then italic.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(src: string): string {
  const blocks = esc(src).replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;

    // Fenced code block (escaped backticks survive escaping).
    const fence = b.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
    if (fence) {
      html.push(`<pre><code>${fence[1]}</code></pre>`);
      continue;
    }

    const lines = b.split("\n");

    // Unordered list.
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`);
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    // Ordered list.
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Heading (single-line block starting with #).
    const heading = b.match(/^(#{1,6})\s+(.*)$/);
    if (heading && lines.length === 1) {
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    // Paragraph; single newlines become <br>.
    html.push(`<p>${lines.map((l) => inline(l)).join("<br>")}</p>`);
  }

  return html.join("\n");
}
