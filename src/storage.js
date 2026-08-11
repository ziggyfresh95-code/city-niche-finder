// Thin wrapper around chrome.storage.local for favorites + settings.
// Favorites hold two kinds of records:
//   type "combo"   -> a keyword+city opportunity you rated (5-star + tags)
//   type "listing" -> a specific business you want to reach out to (a lead)

const STORE_KEYS = {
  favorites: "cnf_favorites",
  settings: "cnf_settings",
};

const DEFAULT_SETTINGS = {
  reviewThreshold: 30,
  rdThreshold: 20,
  resultCount: 30,     // how many organic results to consider
  theme: "dark",
  // Turbo (nearby-city expansion) defaults
  turboDistance: 25,   // radius in miles
  turboPopMin: 0,      // minimum city population
  turboPopMax: 150000, // maximum city population (smaller towns = less competition)
  turboLimit: 25,      // max cities to return
  turboSameState: false,
};

function _get(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      resolve(res[key] === undefined ? fallback : res[key]);
    });
  });
}

function _set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function getSettings() {
  const s = await _get(STORE_KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...s };
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await _set(STORE_KEYS.settings, next);
  return next;
}

async function getFavorites() {
  return _get(STORE_KEYS.favorites, []);
}

// Stable id so re-favoriting the same thing updates instead of duplicating.
function favId(fav) {
  const base = [
    fav.type,
    (fav.keyword || "").toLowerCase().trim(),
    (fav.location || "").toLowerCase().trim(),
    (fav.url || fav.name || "").toLowerCase().trim(),
  ].join("|");
  return base;
}

async function upsertFavorite(fav) {
  const list = await getFavorites();
  const id = fav.id || favId(fav);
  const record = { ...fav, id, date: fav.date || new Date().toISOString() };
  const idx = list.findIndex((f) => f.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...record };
  else list.push(record);
  await _set(STORE_KEYS.favorites, list);
  return record;
}

async function removeFavorite(id) {
  const list = await getFavorites();
  const next = list.filter((f) => f.id !== id);
  await _set(STORE_KEYS.favorites, next);
  return next;
}

async function isFavorited(fav) {
  const id = favId(fav);
  const list = await getFavorites();
  return list.some((f) => f.id === id);
}

// CSV export used by the favorites page. Handles quoting.
function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => esc(c.get(r))).join(","))
    .join("\n");
  return header + "\n" + body;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORE_KEYS, DEFAULT_SETTINGS, getSettings, saveSettings,
    getFavorites, upsertFavorite, removeFavorite, isFavorited, favId, toCsv,
  };
}
