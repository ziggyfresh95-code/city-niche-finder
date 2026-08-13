// Content script: injects the City Niche Finder sidebar onto Google results
// pages. Relies on globals from parser.js, scoring.js, storage.js (all loaded
// into the same isolated content-script world by the manifest).

(function () {
  const HOST_ID = "cnf-root";
  if (document.getElementById(HOST_ID)) return; // already injected

  let state = {
    keyword: "",
    location: "",
    mapPack: [],
    organic: [],
    mapPackScore: null,
    domainScore: null,
    overall: null,
    settings: null,
    tab: "mappack",
    collapsed: false,
    rating: 0,
    tags: "",
    turboCities: null, // null = not generated yet
  };

  function getQueryParam() {
    const params = new URLSearchParams(location.search);
    return params.get("q") || "";
  }

  function batchInfo() {
    const p = new URLSearchParams(location.search);
    const batchId = p.get("cnf_batch");
    if (!batchId) return null;
    return { batchId, keyword: p.get("cnf_kw") || "", location: p.get("cnf_loc") || "" };
  }

  async function scan() {
    state.settings = await getSettings();
    const batch = batchInfo();
    const parsed = splitQuery(getQueryParam());
    // A batch tab carries the exact keyword/location, so prefer those.
    if (batch && batch.keyword) state.keyword = batch.keyword;
    if (batch && batch.location) state.location = batch.location;
    if (!state.keyword) state.keyword = parsed.keyword;
    if (!state.location) state.location = parsed.location;

    state.mapPack = parseMapPack(state.location);
    state.organic = parseOrganic(state.keyword, state.location, state.settings.resultCount);

    const th = { reviewThreshold: state.settings.reviewThreshold, rdThreshold: state.settings.rdThreshold };
    state.mapPackScore = scoreMapPack(state.mapPack, th);
    state.domainScore = scoreDomains(state.organic, th);
    state.overall = overallScore(state.mapPackScore, state.domainScore);
    render();

    if (state.settings.autoCollectNoWebsite) {
      const noSite = state.mapPack.filter((l) => !l.hasWebsite);
      if (noSite.length > 0) await collectNoWebsite(noSite, true);
    }

    // Batch mode: auto-save this city's scored combo, then tell the background
    // worker we're done so it can close this tab and open the next.
    if (batch) {
      await upsertFavorite({
        type: "combo",
        keyword: state.keyword,
        location: state.location,
        stars: 0,
        tags: ["turbo-batch"],
        overallScore: state.overall ? state.overall.score : "",
        mapPackScore: state.mapPackScore ? state.mapPackScore.score : "",
        domainScore: state.domainScore ? state.domainScore.score : "",
        mapPackCount: state.mapPack.length,
        dedicatedCount: state.organic.filter((r) => r.isDedicated).length,
      });
      chrome.runtime.sendMessage({ type: "turbo-batch-done", batchId: batch.batchId });
    }
  }

  // ---- rendering ----------------------------------------------------------

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  function scorePill(label, s) {
    const val = s && s.score != null ? s.score : "–";
    const color = s ? s.color : "gray";
    return el("div", { class: `cnf-pill cnf-${color}`, title: (s && s.reasons ? s.reasons.join(" · ") : "") },
      [el("span", { class: "cnf-pill-label" }, label), el("span", { class: "cnf-pill-val" }, `${val}/100`)]);
  }

  function render() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = el("div", { id: HOST_ID });
      document.documentElement.appendChild(host);
    }
    host.innerHTML = "";
    host.className = state.collapsed ? "cnf-collapsed" : "";

    if (state.collapsed) {
      host.appendChild(el("button", { class: "cnf-fab", title: "Open City Niche Finder", onclick: () => { state.collapsed = false; render(); } }, "CNF"));
      return;
    }

    const panel = el("div", { class: "cnf-panel" });

    // Header
    const spoofed = new URLSearchParams(location.search).has("uule");
    const version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "?";
    panel.appendChild(el("div", { class: "cnf-header" }, [
      el("div", { class: "cnf-logo" }, [
        "🎯 City Niche Finder",
        el("span", { class: "cnf-ver", title: "Extension version" }, `v${version}`),
        spoofed ? el("span", { class: "cnf-geo", title: "Results geo-spoofed to the target city (UULE)" }, "📍") : null,
      ]),
      el("div", { class: "cnf-header-btns" }, [
        el("button", { class: "cnf-icon", title: "Rescan page", onclick: scan }, "⟳"),
        el("button", { class: "cnf-icon", title: "Copy debug info (paste it to share)", onclick: copyDebug }, "🐞"),
        el("button", { class: "cnf-icon", title: "Favorites", onclick: () => chrome.runtime.sendMessage({ type: "open-favorites" }) }, "★"),
        el("button", { class: "cnf-icon", title: "Collapse", onclick: () => { state.collapsed = true; render(); } }, "×"),
      ]),
    ]));

    // Keyword + location inputs
    const kwInput = el("input", { class: "cnf-input", placeholder: "Keyword", value: state.keyword });
    kwInput.addEventListener("change", (e) => { state.keyword = e.target.value; });
    const locInput = el("input", { class: "cnf-input", placeholder: "City, ST", value: state.location });
    locInput.addEventListener("change", (e) => { state.location = e.target.value; });
    const runSearch = () => newSearch(kwInput.value.trim(), locInput.value.trim());
    kwInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
    locInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
    const searchBtn = el("button", { class: "cnf-go", title: "Run a new Google search here", onclick: runSearch }, "Search");
    panel.appendChild(el("div", { class: "cnf-row" }, [kwInput, locInput, searchBtn]));

    // Scores
    panel.appendChild(el("div", { class: "cnf-scores" }, [
      scorePill("Overall", state.overall),
      scorePill(`Map Pack (${state.mapPack.length})`, state.mapPackScore),
      scorePill(`Sites (${state.organic.length})`, state.domainScore),
    ]));

    // Tabs
    const tabs = el("div", { class: "cnf-tabs" }, [
      tabBtn("mappack", `Map Pack (${state.mapPack.length})`),
      tabBtn("sites", `Sites (${state.organic.length})`),
      tabBtn("turbo", "🚀 Turbo"),
      tabBtn("rate", "Rate & Save"),
    ]);
    panel.appendChild(tabs);

    const body = el("div", { class: "cnf-body" });
    if (state.tab === "mappack") body.appendChild(renderMapPack());
    else if (state.tab === "sites") body.appendChild(renderSites());
    else if (state.tab === "turbo") body.appendChild(renderTurbo());
    else body.appendChild(renderRate());
    panel.appendChild(body);

    host.appendChild(panel);
  }

  function tabBtn(id, label) {
    return el("button", {
      class: "cnf-tab" + (state.tab === id ? " cnf-tab-active" : ""),
      onclick: () => { state.tab = id; render(); },
    }, label);
  }

  function reasonsBlock(s) {
    if (!s || !s.reasons) return null;
    return el("ul", { class: "cnf-reasons" }, s.reasons.map((r) => el("li", {}, r)));
  }

  function renderMapPack() {
    const wrap = el("div", {});
    wrap.appendChild(reasonsBlock(state.mapPackScore));
    if (state.mapPack.length === 0) {
      wrap.appendChild(el("div", { class: "cnf-empty" }, "No Map Pack rows detected. Scroll the page or rescan."));
      return wrap;
    }
    const noSite = state.mapPack.filter((l) => !l.hasWebsite);
    if (noSite.length > 0) {
      wrap.appendChild(el("button", {
        class: "cnf-collect",
        title: "Save every no-website listing as a lead, tagged no-website",
        onclick: () => collectNoWebsite(noSite),
      }, `＋ Collect ${noSite.length} no-website lead${noSite.length > 1 ? "s" : ""}`));
    }
    for (const l of state.mapPack) {
      const badge = l.hasWebsite ? el("span", { class: "cnf-tag" }, "has site") : el("span", { class: "cnf-tag cnf-good" }, "NO WEBSITE");
      wrap.appendChild(el("div", { class: "cnf-item" }, [
        el("div", { class: "cnf-item-main" }, [
          el("div", { class: "cnf-item-name" }, l.name),
          el("div", { class: "cnf-item-meta" }, [
            l.rating != null ? `★ ${l.rating}` : "no rating",
            l.reviews != null ? ` · ${l.reviews} reviews` : "",
            l.phone ? ` · ${l.phone}` : "",
            l.locationMatch ? " · city match" : "",
          ].join("")),
        ]),
        badge,
        el("button", { class: "cnf-save", title: "Save as lead", onclick: () => saveLead(l) }, "＋lead"),
      ]));
    }
    return wrap;
  }

  function renderSites() {
    const wrap = el("div", {});
    wrap.appendChild(reasonsBlock(state.domainScore));
    if (state.organic.length === 0) {
      wrap.appendChild(el("div", { class: "cnf-empty" }, "No organic results detected. Rescan the page."));
      return wrap;
    }
    state.organic.forEach((r, i) => {
      wrap.appendChild(el("div", { class: "cnf-item" }, [
        el("div", { class: "cnf-item-main" }, [
          el("div", { class: "cnf-item-name" }, `${i + 1}. ${r.domain}`),
          el("div", { class: "cnf-item-meta" }, [
            r.isDedicated ? "dedicated site" : "general/directory",
            r.rd != null ? ` · RD ${r.rd}` : "",
            r.locationMatch ? " · city match" : "",
          ].join("")),
        ]),
        el("button", { class: "cnf-save", title: "Save as lead", onclick: () => saveLead({ name: r.domain, url: r.url }) }, "＋lead"),
      ]));
    });
    return wrap;
  }

  function renderTurbo() {
    const wrap = el("div", { class: "cnf-turbo" });
    const s = state.settings;

    // Controls
    const dist = el("input", { class: "cnf-input cnf-num", type: "number", min: "1", max: "300", value: s.turboDistance, title: "Radius (miles)" });
    const pmin = el("input", { class: "cnf-input cnf-num", type: "number", min: "0", value: s.turboPopMin, title: "Min population" });
    const pmax = el("input", { class: "cnf-input cnf-num", type: "number", min: "0", value: s.turboPopMax, title: "Max population" });
    wrap.appendChild(el("div", { class: "cnf-turbo-controls" }, [
      labeled("Radius mi", dist), labeled("Pop min", pmin), labeled("Pop max", pmax),
    ]));

    const generate = () => {
      const opts = {
        distanceMiles: parseInt(dist.value, 10) || 25,
        popMin: parseInt(pmin.value, 10) || 0,
        popMax: parseInt(pmax.value, 10) || Infinity,
        limit: s.turboLimit,
        sameStateOnly: s.turboSameState,
      };
      const res = expandLocation(state.location, opts);
      state.turboOrigin = res.origin;
      state.turboCities = res.cities;
      render();
    };
    wrap.appendChild(el("button", { class: "cnf-primary", onclick: generate }, "🚀 Find nearby cities"));

    if (state.turboCities == null) {
      wrap.appendChild(el("div", { class: "cnf-hint" }, `Expand "${state.location || "?"}" into nearby cities for "${state.keyword || "?"}". Each opens a fresh scored search.`));
      return wrap;
    }
    if (!state.turboOrigin) {
      wrap.appendChild(el("div", { class: "cnf-empty" }, `Couldn't match "${state.location}" to a city. Try "City, ST" (e.g. Tampa, FL).`));
      return wrap;
    }
    wrap.appendChild(el("div", { class: "cnf-hint" }, `From ${state.turboOrigin.name}, ${state.turboOrigin.state} — ${state.turboCities.length} nearby cities:`));
    if (state.turboCities.length === 0) {
      wrap.appendChild(el("div", { class: "cnf-empty" }, "No cities in range. Increase the radius or population max."));
      return wrap;
    }
    if (state.keyword) {
      wrap.appendChild(el("button", {
        class: "cnf-collect",
        title: "Auto-score every city in the background and open a ranked report",
        onclick: () => runBatch(),
      }, `🔬 Batch-scan all ${state.turboCities.length} cities`));
    } else {
      wrap.appendChild(el("div", { class: "cnf-hint" }, "Set a keyword above to enable batch scanning."));
    }
    for (const c of state.turboCities) {
      wrap.appendChild(el("div", { class: "cnf-item" }, [
        el("div", { class: "cnf-item-main" }, [
          el("div", { class: "cnf-item-name" }, `${c.name}, ${c.state}`),
          el("div", { class: "cnf-item-meta" }, `${c.distance} mi · pop ${c.pop.toLocaleString()}`),
        ]),
        el("button", { class: "cnf-save", title: "Open scored search here", onclick: () => openTurboSearch(c) }, "search →"),
      ]));
    }
    return wrap;
  }

  function labeled(label, input) {
    return el("label", { class: "cnf-labeled" }, [el("span", {}, label), input]);
  }

  // Run a brand-new Google search from the sidebar (no need to reopen the popup
  // in a new tab). Navigates the current tab; the sidebar re-scans on load.
  function newSearch(keyword, locationStr) {
    if (!keyword && !locationStr) { toast("Enter a keyword and city"); return; }
    state.keyword = keyword;
    state.location = locationStr;
    const [c, s] = locationStr.split(",");
    const locParts = { city: (c || "").trim(), state: (s || "").trim().slice(0, 2).toUpperCase() };
    const url = buildSearchUrl(keyword, locParts, state.settings.geoSpoof);
    window.location.href = url;
  }

  function openTurboSearch(city) {
    const url = buildSearchUrl(
      state.keyword,
      { city: city.name, state: city.state },
      state.settings.geoSpoof
    );
    window.open(url, "_blank");
  }

  function runBatch() {
    const urls = state.turboCities.map((c) => {
      const base = buildSearchUrl(state.keyword, { city: c.name, state: c.state }, state.settings.geoSpoof);
      const sep = base.includes("?") ? "&" : "?";
      return base + sep +
        "cnf_kw=" + encodeURIComponent(state.keyword) +
        "&cnf_loc=" + encodeURIComponent(`${c.name}, ${c.state}`);
    });
    chrome.runtime.sendMessage({ type: "turbo-batch-start", urls });
    toast(`Batch-scanning ${urls.length} cities… a report opens when done`);
  }

  function renderRate() {
    const wrap = el("div", { class: "cnf-rate" });
    wrap.appendChild(el("div", { class: "cnf-rate-title" }, `Rate "${state.keyword || "?"}" in "${state.location || "?"}"`));

    // Star picker
    const stars = el("div", { class: "cnf-stars" });
    for (let i = 1; i <= 5; i++) {
      stars.appendChild(el("span", {
        class: "cnf-star" + (i <= state.rating ? " cnf-star-on" : ""),
        onclick: () => { state.rating = i; render(); },
      }, "★"));
    }
    wrap.appendChild(stars);

    const tagInput = el("input", { class: "cnf-input", placeholder: "tags (comma separated)", value: state.tags });
    tagInput.addEventListener("change", (e) => { state.tags = e.target.value; });
    wrap.appendChild(tagInput);

    wrap.appendChild(el("button", { class: "cnf-primary", onclick: saveCombo }, "Save to Favorites"));
    wrap.appendChild(el("div", { class: "cnf-hint" }, "Saved combos + leads are on the Favorites page (★ up top), exportable to CSV."));
    return wrap;
  }

  // ---- actions ------------------------------------------------------------

  function recompute() {
    const th = { reviewThreshold: state.settings.reviewThreshold, rdThreshold: state.settings.rdThreshold };
    state.mapPack = parseMapPack(state.location);
    state.organic = parseOrganic(state.keyword, state.location, state.settings.resultCount);
    state.mapPackScore = scoreMapPack(state.mapPack, th);
    state.domainScore = scoreDomains(state.organic, th);
    state.overall = overallScore(state.mapPackScore, state.domainScore);
    render();
  }

  async function saveLead(l, tags) {
    await upsertFavorite({
      type: "listing",
      keyword: state.keyword,
      location: state.location,
      name: l.name,
      phone: l.phone || "",
      url: l.url || "",
      reviews: l.reviews != null ? l.reviews : "",
      rating: l.rating != null ? l.rating : "",
      hasWebsite: l.hasWebsite ? "yes" : "no",
      tags: tags || [],
    });
    toast(`Saved lead: ${l.name}`);
  }

  // Bulk-save every no-website Map Pack listing as a cold-call lead.
  async function collectNoWebsite(listings, silent) {
    for (const l of listings) {
      await upsertFavorite({
        type: "listing",
        keyword: state.keyword,
        location: state.location,
        name: l.name,
        phone: l.phone || "",
        url: "",
        reviews: l.reviews != null ? l.reviews : "",
        rating: l.rating != null ? l.rating : "",
        hasWebsite: "no",
        tags: ["no-website"],
      });
    }
    if (!silent) toast(`Collected ${listings.length} no-website lead${listings.length > 1 ? "s" : ""} ★`);
  }

  async function saveCombo() {
    if (!state.keyword && !state.location) { toast("Enter a keyword and city first"); return; }
    await upsertFavorite({
      type: "combo",
      keyword: state.keyword,
      location: state.location,
      stars: state.rating,
      tags: state.tags.split(",").map((t) => t.trim()).filter(Boolean),
      overallScore: state.overall ? state.overall.score : "",
      mapPackScore: state.mapPackScore ? state.mapPackScore.score : "",
      domainScore: state.domainScore ? state.domainScore.score : "",
      mapPackCount: state.mapPack.length,
      dedicatedCount: state.organic.filter((r) => r.isDedicated).length,
    });
    toast("Saved to Favorites ★");
  }

  // Copy diagnostic info to the clipboard so page-structure issues can be
  // shared and fixed precisely. Captures which container was found and the
  // outerHTML of likely local-business blocks (public business info).
  async function copyDebug() {
    const rev = /\((\d[\d,]{0,6})\)(?!\s*[-\d])/;
    const rootSel = document.querySelector("#center_col") ? "#center_col"
      : document.querySelector("#rso") ? "#rso"
      : document.querySelector("#search") ? "#search" : "body";
    const root = document.querySelector(rootSel) || document.body;

    const blocks = [];
    let anyParenDigit = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.innerText || n.textContent || "";
      if (/\(\d/.test(t) && t.length < 400) anyParenDigit++;
      if (blocks.length >= 5) continue;
      if (t.length > 400 || !rev.test(t)) continue;
      if (blocks.some((b) => b.contains(n))) continue;
      blocks.push(n);
    }

    // Fallback: if no review-token blocks, grab the "Businesses" heading's
    // container so the real structure is still captured.
    let bizContainer = "";
    if (blocks.length === 0) {
      const all = root.querySelectorAll("*");
      for (const e of all) {
        if ((e.textContent || "").trim().slice(0, 12).toLowerCase() === "businesses" && e.children.length === 0) {
          const c = e.closest("div")?.parentElement || e.parentElement;
          bizContainer = (c ? c.outerHTML : "").replace(/\s+/g, " ").slice(0, 3000);
          break;
        }
      }
    }

    const lines = [
      "=== City Niche Finder debug ===",
      "version: v" + (chrome.runtime.getManifest().version || "?"),
      "url: " + location.href.slice(0, 200),
      `keyword="${state.keyword}" location="${state.location}"`,
      "root container: " + rootSel,
      `parsed: mapPack=${state.mapPack.length}, organic=${state.organic.length}`,
      `elements with "(digit": ${anyParenDigit}`,
      `review-token blocks: ${blocks.length}`,
    ];
    blocks.forEach((b, i) => {
      lines.push(`\n--- block ${i + 1} outerHTML (truncated) ---`);
      lines.push(b.outerHTML.replace(/\s+/g, " ").slice(0, 1200));
    });
    if (bizContainer) {
      lines.push("\n--- 'Businesses' container outerHTML (truncated) ---");
      lines.push(bizContainer);
    }
    const out = lines.join("\n");
    try {
      await navigator.clipboard.writeText(out);
      toast("Debug copied — paste it to me");
    } catch (e) {
      console.log("[City Niche Finder debug]\n" + out);
      toast("Debug printed to console (clipboard blocked)");
    }
  }

  function toast(msg) {
    const t = el("div", { class: "cnf-toast" }, msg);
    document.getElementById(HOST_ID).appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // Kick off after the page settles a bit (map pack loads async).
  if (getQueryParam()) {
    setTimeout(scan, 900);
  }
})();
