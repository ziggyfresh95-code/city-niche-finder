// Service worker: opens the Favorites page when asked by the content script.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "open-favorites") {
    chrome.tabs.create({ url: chrome.runtime.getURL("favorites.html") });
  }
});
