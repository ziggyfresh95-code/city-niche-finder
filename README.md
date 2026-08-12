# City Niche Finder

A free, personal Chrome extension that speeds up the **due-diligence phase** of
local rank-and-rent — finding a niche + city combo that *should* be competitive
but isn't. It reads Google's Map Pack and organic results right off the page you're
already viewing, scores the competition 0–100, and lets you save leads, rate
niches, and export everything to CSV. No API keys, no monthly cost.

Built for my own workflow after studying how a paid tool (Niche Finder Pro) works.

---

## What it does

- **0–100 opportunity scoring** — color-coded score for the Map Pack and for the
  organic ("dedicated sites") competition. Green = low competition, jump on it;
  red = crowded, move on. Scores are transparent — the sidebar shows *why* it
  scored the way it did (avg reviews, city-name matches, no-website count,
  dedicated-site count, referring domains).
- **Search launcher + random niche suggester** — from the toolbar popup, type a
  keyword and city (or hit 🎲 for a random niche from 90+ across 10 categories)
  and it opens a scored Google search.
- **Location spoofing (UULE)** — searches run *as if you were in the target city*,
  so the Map Pack and scores reflect that market instead of wherever you actually
  are. On by default; toggle it in the popup. Turbo searches inherit it, so every
  nearby-city search is accurate too. A 📍 shows in the sidebar when active.
- **Turbo nearby-city expansion** — expand one city into nearby cities filtered by
  radius (up to 300 mi) and population range, ranked by distance. Each result
  opens a fresh scored search — batch-analyze a whole region. Uses a bundled
  offline US cities dataset (no network calls).
- **Save leads** — one click saves any Map Pack or organic listing (name, phone,
  website / no-website flag, reviews) as a prospect.
- **Rate & tag niches** — give each keyword+city combo a 5-star rating and custom
  tags, so you can build a shortlist.
- **Favorites page** — browse rated niches and saved leads, filter by rating, tag,
  or text, and **export to CSV** for a VA or your own follow-up.
- **Configurable thresholds** — review threshold (default 30) and referring-domain
  threshold (default 20), matching common rank-and-rent guidance.
- **Ahrefs-aware** — if you have the Ahrefs SEO Toolbar installed, its referring-
  domain (RD) numbers get pulled into the score automatically. Not required.

## Install (unpacked, ~1 minute)

1. Download / clone this repo.
2. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this project folder.
5. Pin the 🎯 icon from the extensions menu for easy access.

## How to use

1. Click the 🎯 toolbar icon. Enter a **keyword** and **city, ST** (or hit 🎲 for a
   random niche), then **Search Google & Score**.
2. On the results page, the sidebar appears on the right with the scores.
   - **Map Pack tab** — the local 3-pack, review counts, and who has no website.
   - **Sites tab** — organic competitors, whether each looks like a dedicated
     niche site, and RD if Ahrefs is installed.
   - **Rate & Save tab** — give the combo a star rating + tags and save it.
   - **🚀 Turbo tab** — set a radius and population range, hit **Find nearby
     cities**, and get a distance-ranked list of nearby towns. Click **search →**
     on any of them to open a fresh scored search for that city.
3. Click **＋lead** on any listing to save it as a prospect.
4. Click the ★ button (top of the sidebar, or in the popup) to open the
   **Favorites** page, filter/sort, and **Export CSV**.

Turbo defaults (radius, population range, max cities, same-state-only) live in
the popup's ⚙ Settings and can be overridden per-run in the Turbo tab.

The keyword/city fields in the sidebar are editable — if the automatic split of
your query is off (multi-word cities, etc.), fix it there and it rescans.

## How the score works

All logic lives in [`src/scoring.js`](src/scoring.js) and is intentionally simple
and transparent:

- **Map Pack score** = 100 − competition, where competition is weighted from the
  average review count (vs. your threshold), how many listings match the city
  name, and how many already have websites.
- **Domain score** = 100 − competition, driven by the share of results that look
  like dedicated niche sites and (if available) their average referring domains.
- **Overall** = 60% Map Pack + 40% Domain.

Tune the thresholds in the popup's ⚙ Settings.

## Project layout

```
manifest.json          # MV3 config
popup.html             # toolbar popup (search launcher + settings)
favorites.html         # saved leads & rated niches, CSV export
icons/                 # extension icons
src/
  niches.js            # curated niche database + random picker
  scoring.js           # opportunity scoring (pure, testable)
  parser.js            # Google SERP parsing (map pack + organic)
  cities.js            # bundled US cities dataset (GeoNames, offline)
  turbo.js             # nearby-city expansion (Haversine + lookup)
  uule.js              # location spoofing (UULE) + search-URL builder
  storage.js           # chrome.storage helpers + CSV builder
  content.js           # injects & renders the sidebar
  content.css          # sidebar styles
  popup.js / popup.css
  favorites.js / favorites.css
  background.js        # opens the favorites page
```

## Known limitations & roadmap

- **Google's HTML changes often.** Parsing uses resilient text/structure
  heuristics (in `src/parser.js`) rather than brittle class names, but if Google
  reshuffles their markup and detection degrades, the sidebar still works — you can
  rate and save manually — and only `src/parser.js` needs updating.
- **Turbo dataset floor is ~15,000 population.** The bundled `src/cities.js` comes
  from GeoNames' cities-15000 set (3,400+ US cities). That covers every metro and
  its significant suburbs, but not sub-15k small towns. To include smaller towns,
  swap `src/cities.js` for a denser dataset in the same
  `[name, state, lat, lng, population]` row format — the Turbo code doesn't change.
- **RD data** currently comes from the Ahrefs SEO Toolbar if you have it. Direct
  integration would need an Ahrefs API key.

## Data & attribution

The bundled US cities dataset (`src/cities.js`) is derived from
[GeoNames](https://www.geonames.org/) (cities ≥ 15,000 population), licensed
under CC-BY 4.0.

*Personal-use project. Not affiliated with Niche Finder Pro or Ahrefs.*
