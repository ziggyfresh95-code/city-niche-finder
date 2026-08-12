// Location spoofing via Google's UULE parameter.
//
// Appending &uule=<encoded> to a Google search URL makes Google return results
// as if the searcher were physically in that location — critical for accurate
// local Map Pack scoring when you're researching a city you're not in.
//
// This uses the canonical-name ("role 2") UULE encoding, which is the most
// robust form to generate: base64 of a "City,State,United States" canonical
// string, prefixed with Google's fixed key + a length-derived character.

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

// UTF-8 safe base64 (btoa alone mangles multibyte chars).
function _b64(str) {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return Buffer.from(str, "utf-8").toString("base64"); // Node (tests)
}

// Build Google's canonical location name, e.g. "Tampa,Florida,United States".
function canonicalName(city, stateAbbr) {
  const state = STATE_NAMES[(stateAbbr || "").toUpperCase()] || stateAbbr || "";
  return [city, state, "United States"].filter(Boolean).join(",");
}

// Encode a canonical location string into a UULE value.
function encodeUULE(canonical) {
  if (!canonical) return "";
  const lengthKey =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[
      canonical.length % 64
    ];
  return "w+CAIQICI" + lengthKey + _b64(canonical);
}

// Convenience: from raw city + state abbreviation to the UULE value.
function uuleFor(city, stateAbbr) {
  return encodeUULE(canonicalName(city, stateAbbr));
}

// Build a scored Google search URL with optional geo-spoofing.
// locParts: { city, state } (state = 2-letter abbr). geoSpoof: boolean.
function buildSearchUrl(keyword, locParts, geoSpoof) {
  const loc = locParts && locParts.city
    ? `${locParts.city}${locParts.state ? ", " + locParts.state : ""}`
    : "";
  const q = [keyword, loc].filter(Boolean).join(" ").trim();
  let url = "https://www.google.com/search?q=" + encodeURIComponent(q) + "&num=30";
  if (geoSpoof && locParts && locParts.city) {
    const uule = uuleFor(locParts.city, locParts.state);
    if (uule) url += "&uule=" + encodeURIComponent(uule) + "&gl=us&hl=en";
  }
  return url;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { STATE_NAMES, canonicalName, encodeUULE, uuleFor, buildSearchUrl };
}
