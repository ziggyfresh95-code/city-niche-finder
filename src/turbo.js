// Turbo: expand one origin city into nearby cities, filtered by distance and
// population — the "batch-analyze a whole region" feature. Relies on the CITIES
// global from cities.js.

function _norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Great-circle distance in miles.
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Parse "City, ST" (or just "City") into parts.
function parseLocation(location) {
  const parts = (location || "").split(",");
  const city = _norm(parts[0]);
  const state = parts.length > 1 ? parts[1].trim().toUpperCase().slice(0, 2) : "";
  return { city, state };
}

// Find the best matching origin city record for a "City, ST" string.
// CITIES is sorted by population desc, so the first match is the largest — the
// one the user almost certainly means.
function findCity(location) {
  const { city, state } = parseLocation(location);
  if (!city) return null;
  let exact = null, starts = null;
  for (const c of CITIES) {
    if (state && c.state !== state) continue;
    const n = _norm(c.name);
    if (n === city) { exact = c; break; }
    if (!starts && n.startsWith(city)) starts = c;
  }
  if (exact || starts) return exact || starts;
  // No state filter fallback (user may have omitted / mistyped state).
  if (state) return findCity(city);
  return null;
}

// Return nearby cities to an origin, filtered and sorted by distance.
// opts: { distanceMiles, popMin, popMax, limit, sameStateOnly }
function nearbyCities(origin, opts = {}) {
  const {
    distanceMiles = 25,
    popMin = 0,
    popMax = Infinity,
    limit = 25,
    sameStateOnly = false,
  } = opts;
  if (!origin) return [];

  const out = [];
  for (const c of CITIES) {
    if (c === origin) continue;
    if (sameStateOnly && c.state !== origin.state) continue;
    if (c.pop < popMin || c.pop > popMax) continue;
    const dist = haversineMiles(origin.lat, origin.lng, c.lat, c.lng);
    if (dist > distanceMiles) continue;
    out.push({ ...c, distance: Math.round(dist * 10) / 10 });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

// Convenience: from a "City, ST" string straight to the nearby list.
function expandLocation(location, opts) {
  const origin = findCity(location);
  return { origin, cities: nearbyCities(origin, opts) };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { haversineMiles, findCity, nearbyCities, expandLocation, parseLocation };
}
