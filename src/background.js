// Service worker: opens the Favorites page, and orchestrates Turbo batch scans.
//
// A batch scan opens each nearby-city search in an inactive tab (throttled),
// lets the content script auto-score + save it, then closes the tab and opens
// the next. When the queue drains, it opens the Favorites page as a report.

const MAX_CONCURRENT = 3;   // tabs open at once
const TAB_TIMEOUT_MS = 15000; // advance even if a tab never reports back

const batches = new Map(); // batchId -> { queue, active, done, total, tabs:Map }

function newBatchId() {
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pump(batchId) {
  const b = batches.get(batchId);
  if (!b) return;
  while (b.active < MAX_CONCURRENT && b.queue.length > 0) {
    const url = b.queue.shift();
    b.active++;
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab) { b.active--; pump(batchId); return; }
      const timer = setTimeout(() => finishTab(batchId, tab.id), TAB_TIMEOUT_MS);
      b.tabs.set(tab.id, timer);
    });
  }
  if (b.queue.length === 0 && b.active === 0) finishBatch(batchId);
}

function finishTab(batchId, tabId) {
  const b = batches.get(batchId);
  if (!b || !b.tabs.has(tabId)) return; // already handled
  clearTimeout(b.tabs.get(tabId));
  b.tabs.delete(tabId);
  b.active--;
  b.done++;
  chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
  pump(batchId);
}

function finishBatch(batchId) {
  if (!batches.has(batchId)) return;
  batches.delete(batchId);
  chrome.tabs.create({ url: chrome.runtime.getURL("favorites.html?report=turbo-batch") });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;

  if (msg.type === "open-favorites") {
    chrome.tabs.create({ url: chrome.runtime.getURL("favorites.html") });
    return;
  }

  if (msg.type === "turbo-batch-start" && Array.isArray(msg.urls) && msg.urls.length) {
    const batchId = newBatchId();
    const urls = msg.urls.map((u) => u + (u.includes("?") ? "&" : "?") + "cnf_batch=" + batchId);
    batches.set(batchId, {
      queue: urls, active: 0, done: 0, total: urls.length, tabs: new Map(),
    });
    pump(batchId);
    return;
  }

  if (msg.type === "turbo-batch-done" && sender.tab) {
    const batchId = msg.batchId;
    if (batchId && batches.has(batchId)) finishTab(batchId, sender.tab.id);
    return;
  }
});
