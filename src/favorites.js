// Favorites page: browse rated niche/city combos and saved leads,
// filter/sort/tag them, and export to CSV.

const $ = (id) => document.getElementById(id);
let view = "combos";
let all = [];

async function load() {
  all = await getFavorites();
  populateTagFilter();
  render();
}

function currentRows() {
  const type = view === "combos" ? "combo" : "listing";
  const q = $("search").value.toLowerCase().trim();
  const minRating = parseInt($("ratingFilter").value, 10) || 0;
  const tag = $("tagFilter").value;

  return all
    .filter((f) => f.type === type)
    .filter((f) => {
      if (!q) return true;
      return [f.keyword, f.location, f.name, (f.tags || []).join(" ")]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    .filter((f) => (view === "combos" ? (f.stars || 0) >= minRating : true))
    .filter((f) => (tag ? (f.tags || []).includes(tag) : true))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function populateTagFilter() {
  const tags = new Set();
  all.forEach((f) => (f.tags || []).forEach((t) => tags.add(t)));
  const sel = $("tagFilter");
  sel.innerHTML = '<option value="">All tags</option>' +
    [...tags].sort().map((t) => `<option value="${t}">${t}</option>`).join("");
}

function render() {
  $("tab-combos").classList.toggle("active", view === "combos");
  $("tab-leads").classList.toggle("active", view === "leads");
  $("ratingFilter").style.display = view === "combos" ? "" : "none";

  const rows = currentRows();
  const c = $("content");
  if (rows.length === 0) {
    c.innerHTML = `<div class="empty">Nothing saved here yet. Run a search and use the sidebar to ${view === "combos" ? "rate niches" : "save leads"}.</div>`;
    return;
  }
  c.innerHTML = view === "combos" ? comboTable(rows) : leadTable(rows);
  c.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await removeFavorite(btn.getAttribute("data-del"));
      await load();
    }));
}

function stars(n) {
  n = n || 0;
  return '<span class="stars">' + "★".repeat(n) + "☆".repeat(5 - n) + "</span>";
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function comboTable(rows) {
  return `<table>
    <thead><tr>
      <th>Keyword</th><th>Location</th><th>Rating</th><th>Overall</th>
      <th>Map Pack</th><th>Sites</th><th>Tags</th><th>Date</th><th></th>
    </tr></thead>
    <tbody>${rows.map((f) => `<tr>
      <td>${esc(f.keyword)}</td>
      <td>${esc(f.location)}</td>
      <td>${stars(f.stars)}</td>
      <td>${scoreCell(f.overallScore)}</td>
      <td>${scoreCell(f.mapPackScore)}</td>
      <td>${scoreCell(f.domainScore)}</td>
      <td>${(f.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}</td>
      <td class="muted">${(f.date || "").slice(0, 10)}</td>
      <td><button class="del" data-del="${esc(f.id)}">✕</button></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function leadTable(rows) {
  return `<table>
    <thead><tr>
      <th>Name</th><th>Keyword</th><th>Location</th><th>Phone</th>
      <th>Website</th><th>Reviews</th><th>Tags</th><th>Date</th><th></th>
    </tr></thead>
    <tbody>${rows.map((f) => `<tr>
      <td>${esc(f.name)}</td>
      <td>${esc(f.keyword)}</td>
      <td>${esc(f.location)}</td>
      <td>${esc(f.phone)}</td>
      <td>${f.url ? `<a href="${esc(f.url)}" target="_blank">link</a>` : (f.hasWebsite === "no" ? '<span class="chip good">no site</span>' : "")}</td>
      <td>${esc(f.reviews)}</td>
      <td>${(f.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}</td>
      <td class="muted">${(f.date || "").slice(0, 10)}</td>
      <td><button class="del" data-del="${esc(f.id)}">✕</button></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function scoreCell(v) {
  if (v === "" || v == null) return '<span class="muted">–</span>';
  const n = Number(v);
  const cls = n >= 70 ? "green" : n >= 40 ? "yellow" : "red";
  return `<span class="score ${cls}">${n}</span>`;
}

function doExport() {
  const rows = currentRows();
  let columns;
  if (view === "combos") {
    columns = [
      { label: "Keyword", get: (r) => r.keyword },
      { label: "Location", get: (r) => r.location },
      { label: "Rating", get: (r) => r.stars || 0 },
      { label: "Overall Score", get: (r) => r.overallScore },
      { label: "Map Pack Score", get: (r) => r.mapPackScore },
      { label: "Domain Score", get: (r) => r.domainScore },
      { label: "Map Pack Count", get: (r) => r.mapPackCount },
      { label: "Dedicated Sites", get: (r) => r.dedicatedCount },
      { label: "Tags", get: (r) => (r.tags || []).join("; ") },
      { label: "Date", get: (r) => (r.date || "").slice(0, 10) },
    ];
  } else {
    columns = [
      { label: "Name", get: (r) => r.name },
      { label: "Keyword", get: (r) => r.keyword },
      { label: "Location", get: (r) => r.location },
      { label: "Phone", get: (r) => r.phone },
      { label: "Website", get: (r) => r.url },
      { label: "Has Website", get: (r) => r.hasWebsite },
      { label: "Reviews", get: (r) => r.reviews },
      { label: "Rating", get: (r) => r.rating },
      { label: "Tags", get: (r) => (r.tags || []).join("; ") },
      { label: "Date", get: (r) => (r.date || "").slice(0, 10) },
    ];
  }
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `city-niche-finder-${view}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$("tab-combos").addEventListener("click", () => { view = "combos"; render(); });
$("tab-leads").addEventListener("click", () => { view = "leads"; render(); });
$("search").addEventListener("input", render);
$("ratingFilter").addEventListener("change", render);
$("tagFilter").addEventListener("change", render);
$("export").addEventListener("click", doExport);

load();
