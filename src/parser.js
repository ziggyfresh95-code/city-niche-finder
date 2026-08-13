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

// Review-count token: a parenthesized number NOT followed by more digits/dash
// (so phone numbers like "(830) 293-4750" are excluded).
const REVIEW_RE = /\(\s*(\d[\d,]{0,6})\s*\)(?!\s*[-\d])/;
// Rating: a standalone decimal 0.0–5.0 (won't match "24 hours" or "3+ years").
const RATING_RE = /(?:^|[^\d.])([0-5]\.\d)(?![\d.])/;

// Direct text of an element (its own text nodes only), trimmed.
function ownText(el) {
  let s = "";
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
  return s.trim();
}

// The local pack ("Businesses" / "Places") always has a section heading. Find
// it — its presence is what tells us a local pack exists at all. No heading =
// no local competition (which is itself a strong opportunity signal).
function findLocalHeading(scope) {
  const HEAD = /^(businesses|places|local results|more places)\b/i;
  const els = scope.querySelectorAll("h1,h2,h3,h4,[role='heading'],div,span");
  for (const e of els) {
    const t = ownText(e);
    if (t.length <= 20 && HEAD.test(t)) return e;
  }
  return null;
}

// Organic results and ads carry review snippets too — exclude them so only the
// true local pack is measured. IMPORTANT: do NOT exclude generic wrappers like
// .MjjYud, which Google also uses around the local pack; exclude only organic
// text results (.tF2Cxc / an <h3.LC20lb> blue link) and ad units (aclk/pagead
// links, .Tw0YHf, [data-pcu], [data-text-ad], a "Sponsored" label).
function isOrganicOrAd(el) {
  if (!el.closest) return false;
  // #rhs is the right-hand column (map panel / knowledge panel) — its business
  // labels repeat the local pack and must not be double-counted.
  if (el.closest("#rhs, .tF2Cxc, .yuRUbf, [data-text-ad], [data-pcu], .Tw0YHf, .uEierd, .commercial-unit-desktop-top")) return true;
  if (el.querySelector) {
    if (el.querySelector("h3.LC20lb")) return true;                 // organic blue link
    if (el.querySelector('a[href*="/aclk"], a[href*="googleadservices"], a[href*="/pagead/"]')) return true; // ad
  }
  return false;
}

// A local row must carry a business name — a line with letters that isn't the
// rating/review line or obvious metadata. Careful not to reject real names that
// merely start with "Open" (e.g. "Open Road Towing") or contain "Hour".
function isMetaLine(l) {
  return REVIEW_RE.test(l) ||
    (/\b(open|closed)\b/i.test(l) && /(hour|am|pm|⋅|·|:)/i.test(l)) ||
    /years?\s+in\s+business/i.test(l) ||
    /^(sponsored|businesses|directions|website|call|rating|reviews)\b/i.test(l);
}
function nameLine(txt) {
  return txt.split("\n").map((l) => l.trim()).find(
    (l) => l.length > 1 && /[a-z]/i.test(l) && !isMetaLine(l)
  ) || null;
}

// Rating + review count for a row, trying visible text then aria-labels (Google
// stores "4.9 star rating 31 reviews" in aria-label on many local widgets).
function reviewData(el, txt) {
  let reviews = null, rating = null;
  const tok = txt.match(REVIEW_RE);
  if (tok) reviews = parseInt(tok[1].replace(/,/g, ""), 10);
  const rat = txt.match(RATING_RE);
  if (rat) rating = parseFloat(rat[1]);

  if (reviews == null || rating == null) {
    const ariaEl = el.querySelector('[aria-label*="review" i], [aria-label*="star" i]');
    const aria = (ariaEl && ariaEl.getAttribute("aria-label")) || "";
    if (reviews == null) {
      const a = aria.match(/(\d[\d,]{0,6})\s*reviews?/i);
      if (a) reviews = parseInt(a[1].replace(/,/g, ""), 10);
    }
    if (rating == null) {
      const r = aria.match(/(\d(?:\.\d)?)\s*star/i);
      if (r) rating = parseFloat(r[1]);
    }
  }
  if (reviews == null) {
    const a = txt.match(/(\d[\d,]{0,6})\s+reviews?/i);
    if (a) reviews = parseInt(a[1].replace(/,/g, ""), 10);
  }
  return { reviews, rating };
}

// The one thing local-pack listings always have that organic results and ads
// never do: a "Directions" affordance (and usually a Maps link). This is the
// most reliable local-row signal — review counts are often only in aria-labels.
function hasDirections(el, txt) {
  if (/(^|\n)\s*Directions\s*(\n|$)/.test(txt)) return true;
  return !!(el.querySelector &&
    el.querySelector('a[href*="/maps/dir"], a[data-url*="/maps/dir"], g-more-link a[href*="/maps"]'));
}

// True if the row looks like a local business listing.
function isLocalRow(el, txt, rd) {
  if (!nameLine(txt)) return false;
  return hasDirections(el, txt) || rd.reviews != null || rd.rating != null;
}

// Parse the local "Map Pack" / "Businesses" block (top-3 style local results).
// Scanned across the whole results region (the expanded "big map" layout puts
// the local pack OUTSIDE #center_col), with the right-hand panel, organic
// results, and ads filtered out — so the only rows that survive are genuine
// local listings. No dependence on a section heading or on review counts being
// literal "(N)" text; rows are identified by their "Directions" affordance.
function parseMapPack(location, doc = document) {
  const scope = doc.querySelector("#rcnt") || doc.querySelector("#main") ||
    doc.querySelector("#center_col") || doc.querySelector("#search") || doc.body;
  if (!scope) return [];

  const candidates = [];
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (candidates.length >= 12) break;
    if (isOrganicOrAd(node)) continue;       // never count organic/ads
    const txt = elText(node);
    if (!txt || txt.length > 600) continue;  // too big to be a single row
    const rd = reviewData(node, txt);
    if (!isLocalRow(node, txt, rd)) continue;
    const name = nameLine(txt);
    // Collapse nested matches toward the smallest element that still qualifies.
    const idx = candidates.findIndex((c) => c.el.contains(node));
    if (idx >= 0) { candidates[idx] = { el: node, txt, rd, name }; continue; }
    if (candidates.some((c) => node.contains(c.el))) continue;
    candidates.push({ el: node, txt, rd, name });
  }

  return candidates.slice(0, 6).map((c) => ({
    name: c.name,
    rating: c.rd.rating,
    reviews: c.rd.reviews,
    phone: (c.txt.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [null])[0],
    hasWebsite: /\bwebsite\b/i.test(c.txt) ||
      !!c.el.querySelector('a[href^="http"]:not([href*="google."])'),
    // Match on the row's address text, not the name — the real signal of
    // whether the business is actually in the target city.
    locationMatch: matchesLocation(c.txt, location),
  }));
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
