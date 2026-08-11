// Google SERP parsing.
//
// IMPORTANT: Google's DOM is obfuscated and changes frequently, so this file
// uses layered heuristics (regex on visible text + structural fallbacks)
// rather than brittle class-name selectors. If Google changes their markup and
// parsing degrades, the sidebar still works — you can rate/favorite manually —
// and only the selectors in this one file need updating.

// Pull the keyword + location out of the search box query.
// Heuristic: the location is the trailing "City, ST" or "City" segment.
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

// Parse the local "Map Pack" (top-3 style local results).
function parseMapPack(location) {
  const listings = [];
  const root = document.querySelector("#rso") || document.body;

  // Candidate blocks: elements whose visible text shows a rating + review
  // count like "4.6 (59)" or "4.6(59)". These are almost always map-pack rows.
  const ratingRe = /(\d(?:\.\d)?)\s*\(\s*([\d,]+)\s*\)/;
  const candidates = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  let firstOrganicY = getFirstOrganicY();
  while ((node = walker.nextNode())) {
    if (candidates.length >= 8) break;
    const txt = node.innerText || "";
    if (txt.length > 400) continue;                 // too big to be a single row
    if (!ratingRe.test(txt)) continue;
    // Only consider rows above the first organic result (local pack is on top).
    const y = node.getBoundingClientRect().top + window.scrollY;
    if (firstOrganicY && y > firstOrganicY) continue;
    // Avoid nested duplicates: skip if an ancestor already captured.
    if (candidates.some((c) => c.contains(node) || node.contains(c))) {
      // Prefer the smaller (leaf-ish) element.
      const smallerIdx = candidates.findIndex((c) => c.contains(node));
      if (smallerIdx >= 0) candidates[smallerIdx] = node;
      continue;
    }
    candidates.push(node);
  }

  for (const el of candidates) {
    const txt = el.innerText || "";
    const m = txt.match(ratingRe);
    const rating = m ? parseFloat(m[1]) : null;
    const reviews = m ? parseInt(m[2].replace(/,/g, ""), 10) : null;
    // Business name: the first non-empty line that isn't the rating line.
    const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines.find((l) => !ratingRe.test(l) && l.length > 1) || lines[0] || "Unknown";
    const lower = txt.toLowerCase();
    const hasWebsite = /website/.test(lower) || !!el.querySelector('a[href^="http"]:not([href*="google."])');
    const phone = (txt.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) || [null])[0];
    listings.push({
      name,
      rating,
      reviews,
      phone,
      hasWebsite,
      locationMatch: matchesLocation(name, location),
    });
  }
  return listings;
}

function getFirstOrganicY() {
  const firstH3 = document.querySelector("#rso a h3, #search a h3");
  if (!firstH3) return null;
  return firstH3.getBoundingClientRect().top + window.scrollY;
}

// Parse organic (blue-link) results.
function parseOrganic(keyword, location, limit = 30) {
  const results = [];
  const seen = new Set();
  const anchors = document.querySelectorAll("#search a h3, #rso a h3");
  const kw = normText(keyword);
  const kwWords = kw.split(" ").filter((w) => w.length > 2);

  for (const h3 of anchors) {
    if (results.length >= limit) break;
    const a = h3.closest("a[href]");
    if (!a) continue;
    let href = a.href;
    if (!/^https?:\/\//.test(href)) continue;
    let domain;
    try {
      domain = new URL(href).hostname.replace(/^www\./, "");
    } catch { continue; }
    if (/google\.|gstatic\.|youtube\.|schema\.org/.test(domain)) continue;
    if (seen.has(domain)) continue;      // one row per domain
    seen.add(domain);

    const title = h3.innerText || "";
    const domainNorm = normText(domain);
    const locMatch = matchesLocation(title, location) || matchesLocation(domain, location);
    // Dedicated site heuristic: keyword root(s) appear in the domain itself,
    // or the domain contains the city — i.e. a purpose-built niche/geo site.
    const kwInDomain = kwWords.some((w) => domainNorm.includes(w));
    const isDedicated = kwInDomain || matchesLocation(domain, location);

    const rd = readAhrefsRd(a);        // null unless Ahrefs toolbar present

    results.push({ title, url: href, domain, rd, locationMatch: locMatch, isDedicated });
  }
  return results;
}

// Best-effort read of Ahrefs SEO Toolbar's "RD" (referring domains) badge if
// the user has it installed. Returns a number or null.
function readAhrefsRd(anchorEl) {
  const container = anchorEl.closest(".g, .tF2Cxc, div[data-hveid]") || anchorEl.parentElement;
  if (!container) return null;
  const txt = container.innerText || "";
  const m = txt.match(/RD[:\s]*([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { splitQuery, matchesLocation, parseMapPack, parseOrganic };
}
