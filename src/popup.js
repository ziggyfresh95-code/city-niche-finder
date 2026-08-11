// Popup: launch a scored Google search, suggest a random niche, open favorites,
// and edit thresholds.

const $ = (id) => document.getElementById(id);

function buildSearchUrl(keyword, location) {
  const q = [keyword, location].filter(Boolean).join(" ").trim();
  return "https://www.google.com/search?q=" + encodeURIComponent(q) + "&num=30";
}

async function init() {
  const s = await getSettings();
  $("reviewThreshold").value = s.reviewThreshold;
  $("rdThreshold").value = s.rdThreshold;
  $("resultCount").value = s.resultCount;

  $("random").addEventListener("click", () => {
    const { niche, category } = randomNiche();
    $("keyword").value = niche;
    $("nichehint").textContent = `${category} — hit search or pick a city`;
  });

  $("search").addEventListener("click", () => {
    const url = buildSearchUrl($("keyword").value.trim(), $("location").value.trim());
    chrome.tabs.create({ url });
    window.close();
  });

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
    });
    $("save-settings").textContent = "Saved ✓";
    setTimeout(() => ($("save-settings").textContent = "Save settings"), 1200);
  });
}

init();
