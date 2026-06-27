import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "./markdown.js";

test("renders headings, bold, italic, code", () => {
  assert.match(renderMarkdown("# Title"), /<h1>Title<\/h1>/);
  assert.match(renderMarkdown("**bold**"), /<strong>bold<\/strong>/);
  assert.match(renderMarkdown("_em_"), /<em>em<\/em>/);
  assert.match(renderMarkdown("`x`"), /<code>x<\/code>/);
});

test("renders lists and paragraphs", () => {
  assert.match(renderMarkdown("- a\n- b"), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(renderMarkdown("hello world"), /<p>hello world<\/p>/);
});

test("renders safe links and drops unsafe ones", () => {
  assert.match(renderMarkdown("[ok](https://x.com)"), /<a href="https:\/\/x\.com">ok<\/a>/);
  const xss = renderMarkdown("[bad](javascript:alert(1))");
  assert.doesNotMatch(xss, /href/);
  assert.match(xss, /bad/);
});

test("escapes raw HTML — no XSS", () => {
  const out = renderMarkdown("<script>alert(1)</script>");
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});
