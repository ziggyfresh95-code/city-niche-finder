// Google SERP parsing.
//
// IMPORTANT: Google's DOM is obfuscated and changes frequently, so this file
// uses layered heuristics (regex on visible text + DOM structure/order) rather
// than brittle class-name selectors or layout coordinates. If Google changes
// their markup and parsing degrades, the sidebar still works — you can
// rate/favorite manually — and only the selectors in this one file need
// updating. All functions accept an injectable `doc` so they can be unit-tested
// against saved fixtures (see test/parser.test.js).

// ---- text extraction ------------------------------------------------------

// Deterministic approximation of innerText: block-level elements introduce
// line breaks. Depends only on tag semantics (not CSS rendering), so it behaves
// identically in a real browser and in jsdom-based tests.
const BLOCK_TAGS = new Set([
  "DIV", "P", "LI", "TR", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5",
]);
function elText(el) {
  if (!el) return "";
  let out = "";
  (function walk(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") { out += "\n"; continue; }
        walk(c);
        if (BLOCK_TAGS.has(c.tagName)) out += "\n";
      }
    }
  })(el);
  return out.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

// ---- query + location helpers ---------------------------------------------

// Pull the keyword + location out of the search box query.
function splitQuery(q) {
  if (!q) return { keyword: "", location: "" };
  const query = q.trim();
  // "keyword city, ST" -> the last comma piece is the state; the word right
  // before the comma is the (last word of the) city; everything else is the
  // keyword. Multi-word cities aren't perfectly separable this way, but the
  // sidebar lets you correct the split, so this just needs to be close.
  const commaParts = query.split(",");
  if (commaParts.length >= 2) {
    const state = commaParts[commaParts.length - 1].trim();
    const headSeg = commaParts.slice(0, -1).join(",").trim(); // "keyword city"
    const words = headSeg.split(/\s+/).filter(Boolean);
    const city = words.pop() || "";
    return {
      keyword: words.join(" ").trim(),
      location: city ? `${city}, ${state}` : state,
    };
  }
  // No comma: guess the last word is the city ("towing tampa").
  const words = query.split(/\s+/);
  if (words.length >= 2) {
    return { keyword: words.slice(0, -1).join(" "), location: words.slice(-1)[0] };
  }
  return { keyword: query, location: "" };
}

function normText(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Does `text` contain the city part of a location string?
function matchesLocation(text, location) {
  if (!location) return false;
  const city = location.split(",")[0];
  const n = normText(text);
  const c = normText(city);
  return c.length > 1 && n.includes(c);
}

// ---- structural helpers ---------------------------------------------------

// The <a> wrapping the first organic result heading, or null.
function firstOrganicAnchor(doc) {
  const h3 = doc.querySelector("#search a h3, #rso a h3");
  return h3 ? h3.closest("a[href]") : null;
}

// True if node `a` comes strictly before node `b` in document order and does
// not contain it.
function isBefore(a, b) {
  if (!a || !b) return true;
  const pos = a.compareDocumentPosition(b);
  const FOLLOWING = 4;   // Node.DOCUMENT_POSITION_FOLLOWING
  const CONTAINED = 16;  // b is contained by a
  if (pos & CONTAINED) return false;
  return !!(pos & FOLLOWING);
}

// ---- map pack -------------------------------------------------------------

const RATING_RE = /(\d(?:\.\d)?)\s*\(\s*([\d,]+)\s*\)/;

// A map-pack row must carry a business name, not just a rating — i.e. at least
// one non-empty line that isn't the rating line.
function hasName(txt) {
  return txt.split("\n").some((l) => l.trim().length > 1 && !RATING_RE.test(l.trim()));
}

// Parse the local "Map Pack" (top-3 style local results).
function parseMapPack(location, doc = document) {
  const root = doc.querySelector("#rso") || doc.body;
  if (!root) return [];
  const cutoff = firstOrganicAnchor(doc); // local pack sits before organic

  const candidates = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (candidates.length >= 8) break;
    const txt = elText(node);
    if (!txt || txt.length > 400) continue;   // too big to be a single row
    if (!RATING_RE.test(txt)) continue;
    if (cutoff && !isBefore(node, cutoff)) continue; // must precede organic
    const named = hasName(txt);
    // Collapse nested matches toward the smallest element that STILL has a name
    // (so we don't shrink a listing down to its bare rating badge).
    const ancestorIdx = candidates.findIndex((c) => c.contains(node));
    if (ancestorIdx >= 0) { if (named) candidates[ancestorIdx] = node; continue; }
    if (candidates.some((c) => node.contains(c))) continue; // coarser than existing
    if (named) candidates.push(node);
  }

  return candidates.map((el) => {
    const txt = elText(el);
    const m = txt.match(RATING_RE);
    const rating = m ? parseFloat(m[1]) : null;
    const reviews = m ? parseInt(m[2].replace(/,/g, ""), 10) : null;
    const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines.find((l) => !RATING_RE.test(l) && l.length > 1) || lines[0] || "Unknown";
    const lower = txt.toLowerCase();
    const hasWebsite = /\bwebsite\b/.test(lower) ||
      !!el.querySelector('a[href^="http"]:not([href*="google."])');
    const phone = (txt.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [null])[0];
    return {
      name, rating, reviews, phone, hasWebsite,
      locationMatch: matchesLocation(name, location),
    };
  });
}

// ---- organic results ------------------------------------------------------

// Parse organic (blue-link) results.
function parseOrganic(keyword, location, limit = 30, doc = document) {
  const results = [];
  const seen = new Set();
  const anchors = doc.querySelectorAll("#search a h3, #rso a h3");
  const kwWords = normText(keyword).split(" ").filter((w) => w.length > 2);

  for (const h3 of anchors) {
    if (results.length >= limit) break;
    const a = h3.closest("a[href]");
    if (!a) continue;
    const href = a.href || a.getAttribute("href") || "";
    if (!/^https?:\/\//.test(href)) continue;
    let domain;
    try { domain = new URL(href).hostname.replace(/^www\./, ""); }
    catch { continue; }
    if (/google\.|gstatic\.|youtube\.|schema\.org/.test(domain)) continue;
    if (seen.has(domain)) continue;   // one row per domain
    seen.add(domain);

    const title = (h3.textContent || "").trim();
    const domainNorm = normText(domain);
    const locMatch = matchesLocation(title, location) || matchesLocation(domain, location);
    // Dedicated site heuristic: keyword root(s) in the domain, or the city is
    // in the domain — i.e. a purpose-built niche/geo site (the real competitor).
    const kwInDomain = kwWords.some((w) => domainNorm.includes(w));
    const isDedicated = kwInDomain || matchesLocation(domain, location);
    const rd = readAhrefsRd(a);       // null unless Ahrefs toolbar present

    results.push({ title, url: href, domain, rd, locationMatch: locMatch, isDedicated });
  }
  return results;
}

// Best-effort read of the Ahrefs SEO Toolbar's "RD" (referring domains) badge
// if installed. Returns a number or null.
function readAhrefsRd(anchorEl) {
  const container = anchorEl.closest(".g, .tF2Cxc, div[data-hveid]") || anchorEl.parentElement;
  if (!container) return null;
  const m = elText(container).match(/RD[:\s]*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    elText, splitQuery, matchesLocation, parseMapPack, parseOrganic, firstOrganicAnchor,
  };
}
