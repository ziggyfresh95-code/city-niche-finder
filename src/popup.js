// Popup: launch a scored Google search, suggest a random niche, open favorites,
// and edit thresholds.

const $ = (id) => document.getElementById(id);

// Parse a "City, ST" string into { city, state } for UULE.
function parseLoc(raw) {
  const [c, st] = (raw || "").split(",");
  return { city: (c || "").trim(), state: (st || "").trim().slice(0, 2).toUpperCase() };
}

async function init() {
  const s = await getSettings();
  $("geoSpoof").checked = !!s.geoSpoof;
  $("reviewThreshold").value = s.reviewThreshold;
  $("rdThreshold").value = s.rdThreshold;
  $("resultCount").value = s.resultCount;
  $("turboDistance").value = s.turboDistance;
  $("turboLimit").value = s.turboLimit;
  $("turboPopMin").value = s.turboPopMin;
  $("turboPopMax").value = s.turboPopMax;
  $("turboSameState").checked = !!s.turboSameState;
  $("autoCollectNoWebsite").checked = !!s.autoCollectNoWebsite;

  $("random").addEventListener("click", () => {
    const { niche, category } = randomNiche();
    $("keyword").value = niche;
    $("nichehint").textContent = `${category} — hit search or pick a city`;
  });

  $("search").addEventListener("click", () => {
    const url = buildSearchUrl(
      $("keyword").value.trim(),
      parseLoc($("location").value.trim()),
      $("geoSpoof").checked
    );
    chrome.tabs.create({ url });
    window.close();
  });

  $("geoSpoof").addEventListener("change", () => saveSettings({ geoSpoof: $("geoSpoof").checked }));

  $("keyword").addEventListener("keydown", (e) => { if (e.key === "Enter") $("search").click(); });
  $("location").addEventListener("keydown", (e) => { if (e.key === "Enter") $("search").click(); });

  $("favorites").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("favorites.html") });
  });

  $("settings-toggle").addEventListener("click", () => {
    $("settings").classList.toggle("hidden");
  });

  $("save-settings").addEventListener("click", async () => {
    await saveSettings({
      reviewThreshold: parseInt($("reviewThreshold").value, 10) || 30,
      rdThreshold: parseInt($("rdThreshold").value, 10) || 20,
      resultCount: parseInt($("resultCount").value, 10) || 30,
      turboDistance: parseInt($("turboDistance").value, 10) || 25,
      turboLimit: parseInt($("turboLimit").value, 10) || 25,
      turboPopMin: parseInt($("turboPopMin").value, 10) || 50000,
      turboPopMax: parseInt($("turboPopMax").value, 10) || 500000,
      turboSameState: $("turboSameState").checked,
      autoCollectNoWebsite: $("autoCollectNoWebsite").checked,
    });
    $("save-settings").textContent = "Saved ✓";
    setTimeout(() => ($("save-settings").textContent = "Save settings"), 1200);
  });
}

init();
