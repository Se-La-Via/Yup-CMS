/** The admin dashboard — a single self-contained HTML page (no build step). */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yup CMS — Admin</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 20px;
    border-bottom: 1px solid #8884; position: sticky; top: 0; background: Canvas; }
  header h1 { font-size: 16px; margin: 0; }
  header .spacer { flex: 1; }
  nav { display: flex; gap: 4px; padding: 8px 20px; border-bottom: 1px solid #8883; flex-wrap: wrap; }
  nav button { border: 1px solid #8884; background: transparent; padding: 6px 12px;
    border-radius: 6px; cursor: pointer; color: inherit; }
  nav button.active { background: #4f7cff; color: #fff; border-color: #4f7cff; }
  main { padding: 16px 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #8883; vertical-align: top; }
  th { font-weight: 600; opacity: .7; }
  .btn { border: 1px solid #8884; background: transparent; padding: 4px 10px;
    border-radius: 6px; cursor: pointer; color: inherit; font-size: 13px; }
  .btn.go { background: #1f9d55; color: #fff; border-color: #1f9d55; }
  .btn.no { background: #d23; color: #fff; border-color: #d23; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; background: #8883; }
  input, select { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid #8886; background: Canvas; color: inherit; }
  .muted { opacity: .6; }
  .err { color: #d23; padding: 8px 20px; }
  code { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Yup CMS <span class="muted">Admin</span></h1>
  <span id="tenant" class="pill" hidden></span>
  <div class="spacer"></div>
  <input id="key" type="password" placeholder="admin API key" style="width:280px" />
  <button class="btn" onclick="saveKey()">Connect</button>
</header>
<nav>
  <button data-tab="reviews" class="active" onclick="go('reviews')">Reviews</button>
  <button data-tab="content" onclick="go('content')">Content</button>
  <button data-tab="webhooks" onclick="go('webhooks')">Webhooks</button>
  <button data-tab="assets" onclick="go('assets')">Assets</button>
  <button data-tab="tenants" onclick="go('tenants')">Tenants</button>
  <button data-tab="insights" onclick="go('insights')">Insights</button>
  <button data-tab="assistant" onclick="go('assistant')">Assistant</button>
  <button data-tab="marketplace" onclick="go('marketplace')">Marketplace</button>
</nav>
<div id="err" class="err" hidden></div>
<main id="main">Enter your admin API key to begin.</main>

<script>
const $ = (s) => document.querySelector(s);
let KEY = localStorage.getItem("yup_admin_key") || "";
let TAB = "reviews";
let TYPES = [];
$("#key").value = KEY;

function saveKey() {
  KEY = $("#key").value.trim();
  localStorage.setItem("yup_admin_key", KEY);
  go(TAB);
}
function showErr(m) { const e = $("#err"); e.textContent = m; e.hidden = !m; }
function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "authorization": "Bearer " + KEY, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ("HTTP " + res.status));
  return res.json();
}

async function refreshTenant() {
  const el = $("#tenant");
  if (!KEY) { el.hidden = true; return; }
  try {
    const me = await api("/whoami");
    el.textContent = "tenant: " + (me.tenant || me.tenantId);
    el.hidden = false;
  } catch { el.hidden = true; }
}

function go(tab) {
  TAB = tab;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (!KEY) { $("#main").textContent = "Enter your admin API key to begin."; return; }
  refreshTenant();
  ({ reviews: renderReviews, content: renderContent, webhooks: renderWebhooks, assets: renderAssets, tenants: renderTenants, insights: renderInsights, assistant: renderAssistant, marketplace: renderMarketplace }[tab])();
}

async function renderMarketplace() {
  showErr("");
  try {
    const rows = await api("/marketplace");
    $("#main").innerHTML = "<h3>Plugins &amp; themes</h3>" +
      (rows.length ? "<table><tr><th>Name</th><th>Kind</th><th>Description</th><th></th></tr>" +
        rows.map((m) => "<tr><td>" + esc(m.name) + (m.verified ? " ✓" : "") +
          "</td><td><span class=pill>" + esc(m.kind) + "</span></td><td>" + esc(m.description) +
          " <span class=muted>" + esc(m.specifier) + "</span></td><td>" +
          "<button class='btn go' onclick=\\"install('" + esc(m.name) + "')\\">Install</button></td></tr>").join("") +
        "</table>" : "<p class=muted>Catalog is empty. Publish items via MCP or the admin API.</p>");
  } catch (e) { showErr(e.message); }
}
async function install(name) {
  try {
    const r = await api("/marketplace/install", { method: "POST", body: JSON.stringify({ name }) });
    alert("Installed " + r.name + " (" + r.specifier + ").\\n" + r.note);
  } catch (e) { showErr(e.message); }
}

async function renderInsights() {
  showErr("");
  try {
    const r = await api("/insights");
    $("#main").innerHTML = "<h3>What needs attention</h3><ul>" +
      r.items.map((i) => "<li>" + (i.level === "warn" ? "⚠️ " : "• ") + esc(i.message) + "</li>").join("") +
      "</ul>";
  } catch (e) { showErr(e.message); }
}

let CHAT = [];
async function renderAssistant() {
  showErr("");
  $("#main").innerHTML =
    "<p class=muted>Ask the copilot to find, draft, or publish content. It acts as an agent — publishing gated types goes to the review queue.</p>" +
    "<div id='chat' style='border:1px solid #8883;border-radius:8px;padding:10px;min-height:120px;margin-bottom:8px'></div>" +
    "<div style='display:flex;gap:6px'><input id='ask' style='flex:1' placeholder=\\"e.g. draft a blog post about our launch\\" onkeydown='if(event.key===\\"Enter\\")sendAsk()'><button class='btn go' onclick='sendAsk()'>Send</button></div>";
  drawChat();
}
function drawChat() {
  const el = $("#chat"); if (!el) return;
  el.innerHTML = CHAT.map((m) =>
    "<p><b>" + (m.role === "user" ? "You" : "Copilot") + ":</b> " + esc(m.content) +
    (m.actions && m.actions.length ? "<br><span class=muted>actions: " + esc(m.actions.map((a) => a.tool + (a.ok ? "" : "✗")).join(", ")) + "</span>" : "") +
    "</p>").join("") || "<span class=muted>No messages yet.</span>";
  el.scrollTop = el.scrollHeight;
}
async function sendAsk() {
  const input = $("#ask"); const text = input.value.trim(); if (!text) return;
  input.value = ""; CHAT.push({ role: "user", content: text }); drawChat();
  try {
    const r = await api("/assist", { method: "POST", body: JSON.stringify({ messages: CHAT.map((m) => ({ role: m.role, content: m.content })) }) });
    CHAT.push({ role: "assistant", content: r.reply || "(no reply)", actions: r.actions });
    drawChat();
  } catch (e) {
    CHAT.push({ role: "assistant", content: "Error: " + e.message }); drawChat();
  }
}

async function renderTenants() {
  showErr("");
  try {
    const rows = await api("/tenants");
    $("#main").innerHTML = "<p class=muted>Your admin key is scoped to one tenant; connect with a key from another tenant to manage it.</p>" +
      "<table><tr><th>Slug</th><th>Name</th><th>Created</th></tr>" +
      rows.map((t) => "<tr><td><code>" + esc(t.slug) + "</code></td><td>" + esc(t.name) +
        "</td><td class=muted>" + esc(t.createdAt) + "</td></tr>").join("") + "</table>";
  } catch (e) { showErr(e.message); }
}

async function renderReviews() {
  showErr("");
  try {
    const rows = await api("/reviews?status=pending");
    if (!rows.length) { $("#main").innerHTML = "<p class=muted>No pending reviews. 🎉</p>"; return; }
    $("#main").innerHTML = "<table><tr><th>Requested by</th><th>Entry</th><th>Rev</th><th>Note</th><th></th></tr>" +
      rows.map((r) => "<tr><td>" + esc(r.requestedByType) + ":" + esc(r.requestedById) +
        "</td><td><code>" + esc(r.entryId) + "</code></td><td>" + r.revision +
        "</td><td>" + esc(r.requestNote) + "</td><td>" +
        "<button class='btn go' onclick=\\"decide('" + r.id + "','approve')\\">Approve</button> " +
        "<button class='btn no' onclick=\\"decide('" + r.id + "','reject')\\">Reject</button></td></tr>").join("") +
      "</table>";
  } catch (e) { showErr(e.message); }
}
async function decide(id, action) {
  const note = prompt(action + " note (optional):") || "";
  try { await api("/reviews/" + id + "/" + action, { method: "POST", body: JSON.stringify({ note }) }); renderReviews(); }
  catch (e) { showErr(e.message); }
}

async function renderContent() {
  showErr("");
  try {
    TYPES = await api("/types");
    const opts = TYPES.map((t) => "<option value='" + esc(t.name) + "'>" + esc(t.displayName) + "</option>").join("");
    $("#main").innerHTML = "<p>Type: <select id='type' onchange='loadEntries()'>" + opts +
      "</select> <button class='btn go' onclick='openEditor()'>+ New entry</button></p><div id='entries'></div>";
    if (TYPES.length) loadEntries();
  } catch (e) { showErr(e.message); }
}
function currentType() { return TYPES.find((t) => t.name === $("#type").value); }
async function loadEntries() {
  const type = $("#type").value;
  try {
    const rows = await api("/entries?type=" + encodeURIComponent(type));
    $("#entries").innerHTML = "<table><tr><th>Slug</th><th>Status</th><th>Rev</th><th>Updated</th><th></th></tr>" +
      rows.map((e) => "<tr><td>" + esc(e.slug) + "</td><td><span class=pill>" + esc(e.status) + "</span></td><td>" + e.revision +
        "</td><td class=muted>" + esc(e.updatedAt) + "</td><td>" +
        "<button class='btn' onclick=\\"openEditor('" + e.id + "')\\">Edit</button> " +
        (e.status === "published"
          ? "<button class='btn' onclick=\\"setStatus('" + e.id + "','draft')\\">Unpublish</button>"
          : "<button class='btn go' onclick=\\"setStatus('" + e.id + "','published')\\">Publish</button>") +
        " <button class='btn no' onclick=\\"del('" + e.id + "')\\">Delete</button></td></tr>").join("") +
      "</table>";
  } catch (e) { showErr(e.message); }
}

function fieldInput(f, value) {
  const id = "fld_" + f.name;
  const v = value === undefined || value === null ? "" : value;
  if (f.type === "boolean")
    return "<input type=checkbox id='" + id + "'" + (v ? " checked" : "") + ">";
  if (f.type === "number")
    return "<input type=number id='" + id + "' value='" + esc(v) + "'>";
  if (f.type === "date")
    return "<input id='" + id + "' value='" + esc(v) + "' placeholder='ISO date'>";
  if (f.type === "select")
    return "<select id='" + id + "'>" + (f.options || []).map((o) =>
      "<option" + (o === v ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
  if (f.type === "richtext" || f.type === "json" || f.localized) {
    const text = typeof v === "object" ? JSON.stringify(v) : v;
    return "<textarea id='" + id + "' rows=3 style='width:100%'>" + esc(text) + "</textarea>";
  }
  return "<input id='" + id + "' value='" + esc(v) + "' style='width:100%'>";
}

async function openEditor(id) {
  showErr("");
  const type = currentType();
  if (!type) { showErr("select a type first"); return; }
  let entry = null;
  if (id) {
    try { entry = (await api("/entries/" + id)).entry; } catch (e) { showErr(e.message); return; }
  }
  const data = entry ? entry.data : {};
  const rows = type.fields.map((f) =>
    "<tr><th style='text-align:right'>" + esc(f.name) + (f.required ? " *" : "") +
    "<br><span class=muted>" + esc(f.type) + (f.localized ? " · i18n" : "") + "</span></th><td>" +
    fieldInput(f, data[f.name]) + "</td></tr>").join("");
  $("#main").innerHTML =
    "<h3>" + (id ? "Edit" : "New") + " " + esc(type.displayName) + "</h3>" +
    (id ? "" : "<p>Slug: <input id='fld__slug'></p>") +
    "<table>" + rows + "</table>" +
    "<p><button class='btn go' onclick=\\"saveEntry(" + (id ? "'" + id + "'" : "null") + ")\\">Save</button> " +
    "<button class='btn' onclick='renderContent()'>Cancel</button></p>";
}

async function saveEntry(id) {
  const type = currentType();
  const data = {};
  try {
    for (const f of type.fields) {
      const el = document.getElementById("fld_" + f.name);
      if (!el) continue;
      if (f.type === "boolean") { data[f.name] = el.checked; continue; }
      let raw = el.value;
      if (raw === "" || raw === undefined) continue;
      if (f.type === "number") data[f.name] = Number(raw);
      else if (f.type === "json" || f.localized) data[f.name] = JSON.parse(raw);
      else data[f.name] = raw;
    }
  } catch (e) { showErr("invalid JSON in a field: " + e.message); return; }
  try {
    if (id) {
      await api("/entries/" + id, { method: "POST", body: JSON.stringify({ data }) });
    } else {
      const slugEl = document.getElementById("fld__slug");
      await api("/entries", { method: "POST", body: JSON.stringify({ type: type.name, slug: slugEl && slugEl.value || undefined, data }) });
    }
    renderContent();
  } catch (e) { showErr(e.message); }
}
async function setStatus(id, status) {
  try { await api("/entries/" + id + "/status", { method: "POST", body: JSON.stringify({ status }) }); loadEntries(); }
  catch (e) { showErr(e.message); }
}
async function del(id) {
  if (!confirm("Permanently delete this entry?")) return;
  try { await api("/entries/" + id, { method: "DELETE" }); loadEntries(); }
  catch (e) { showErr(e.message); }
}

async function renderWebhooks() {
  showErr("");
  try {
    const hooks = await api("/webhooks");
    const deliveries = await api("/deliveries");
    $("#main").innerHTML =
      "<h3>Webhooks</h3><table><tr><th>Name</th><th>URL</th><th>Events</th><th>Active</th></tr>" +
      hooks.map((h) => "<tr><td>" + esc(h.name) + "</td><td><code>" + esc(h.url) + "</code></td><td>" +
        esc((h.events || []).join(", ") || "all") + "</td><td>" + h.active + "</td></tr>").join("") + "</table>" +
      "<h3>Recent deliveries</h3><table><tr><th>Event</th><th>Status</th><th>Code</th><th>Attempts</th><th>Error</th></tr>" +
      deliveries.map((d) => "<tr><td>" + esc(d.event) + "</td><td>" + esc(d.status) + "</td><td>" +
        esc(d.statusCode) + "</td><td>" + esc(d.attempts) + "</td><td class=muted>" + esc(d.error) + "</td></tr>").join("") + "</table>";
  } catch (e) { showErr(e.message); }
}

async function renderAssets() {
  showErr("");
  try {
    const rows = await api("/assets");
    $("#main").innerHTML = "<table><tr><th>Filename</th><th>Type</th><th>Size</th><th>Link</th></tr>" +
      rows.map((a) => "<tr><td>" + esc(a.filename) + "</td><td>" + esc(a.contentType) + "</td><td>" + a.size +
        "</td><td><code>/assets/" + esc(a.id) + "</code></td></tr>").join("") + "</table>";
  } catch (e) { showErr(e.message); }
}

if (KEY) go("reviews");
</script>
</body>
</html>`;
