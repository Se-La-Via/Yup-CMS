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
  <div class="spacer"></div>
  <input id="key" type="password" placeholder="admin API key" style="width:280px" />
  <button class="btn" onclick="saveKey()">Connect</button>
</header>
<nav>
  <button data-tab="reviews" class="active" onclick="go('reviews')">Reviews</button>
  <button data-tab="content" onclick="go('content')">Content</button>
  <button data-tab="webhooks" onclick="go('webhooks')">Webhooks</button>
  <button data-tab="assets" onclick="go('assets')">Assets</button>
</nav>
<div id="err" class="err" hidden></div>
<main id="main">Enter your admin API key to begin.</main>

<script>
const $ = (s) => document.querySelector(s);
let KEY = localStorage.getItem("yup_admin_key") || "";
let TAB = "reviews";
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

function go(tab) {
  TAB = tab;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  if (!KEY) { $("#main").textContent = "Enter your admin API key to begin."; return; }
  ({ reviews: renderReviews, content: renderContent, webhooks: renderWebhooks, assets: renderAssets }[tab])();
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
    const types = await api("/types");
    const opts = types.map((t) => "<option value='" + esc(t.name) + "'>" + esc(t.displayName) + "</option>").join("");
    $("#main").innerHTML = "<p>Type: <select id='type' onchange='loadEntries()'>" + opts + "</select></p><div id='entries'></div>";
    if (types.length) loadEntries();
  } catch (e) { showErr(e.message); }
}
async function loadEntries() {
  const type = $("#type").value;
  try {
    const rows = await api("/entries?type=" + encodeURIComponent(type));
    $("#entries").innerHTML = "<table><tr><th>Slug</th><th>Status</th><th>Rev</th><th>Updated</th><th></th></tr>" +
      rows.map((e) => "<tr><td>" + esc(e.slug) + "</td><td><span class=pill>" + esc(e.status) + "</span></td><td>" + e.revision +
        "</td><td class=muted>" + esc(e.updatedAt) + "</td><td>" +
        (e.status === "published"
          ? "<button class='btn' onclick=\\"setStatus('" + e.id + "','draft')\\">Unpublish</button>"
          : "<button class='btn go' onclick=\\"setStatus('" + e.id + "','published')\\">Publish</button>") +
        " <button class='btn no' onclick=\\"del('" + e.id + "')\\">Delete</button></td></tr>").join("") +
      "</table>";
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
