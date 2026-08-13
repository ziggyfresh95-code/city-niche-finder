// Competition / opportunity scoring.
//
// Scores are OPPORTUNITY scores from 0-100 where HIGHER IS BETTER
// (green = low competition, jump on it; red = crowded, move on) — matching
// the NFP convention. Everything here is transparent and threshold-driven so
// you can see exactly why a niche/city scored the way it did.

const DEFAULT_THRESHOLDS = {
  reviewThreshold: 30,     // map-pack review count considered "strong"
  rdThreshold: 20,         // referring domains considered a "strong" site
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function colorFor(score) {
  if (score == null) return "gray";
  if (score >= 70) return "green";   // low competition — go
  if (score >= 40) return "yellow";  // medium — worth a look
  return "red";                      // crowded — move on
}

// listings: [{ name, reviews:Number|null, rating:Number|null,
//              hasWebsite:Bool, locationMatch:Bool }]
function scoreMapPack(listings, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (!listings || listings.length === 0) {
    // No local competition showing at all — wide-open opportunity.
    return { score: 100, color: "green", reasons: ["No Map Pack competition found"] };
  }

  const withReviews = listings.filter(l => typeof l.reviews === "number");
  const avgReviews = withReviews.length
    ? withReviews.reduce((s, l) => s + l.reviews, 0) / withReviews.length
    : 0;
  const withWebsite = listings.filter(l => l.hasWebsite).length;

  // Competition in a Map Pack comes from established, well-reviewed incumbents
  // that already have websites. (City match isn't a signal here — every local
  // listing is in the city by definition.)
  const reviewComponent = clamp((avgReviews / t.reviewThreshold) * 50, 0, 100);
  const websiteComponent = (withWebsite / listings.length) * 100;

  const competition = 0.7 * reviewComponent + 0.3 * websiteComponent;
  const score = Math.round(clamp(100 - competition, 0, 100));

  const noSite = listings.length - withWebsite;
  const reasons = [
    `${listings.length} listing${listings.length > 1 ? "s" : ""}, avg ${Math.round(avgReviews)} reviews (threshold ${t.reviewThreshold})`,
    `${noSite}/${listings.length} have no website${noSite > 0 ? " — potential leads" : ""}`,
  ];
  return { score, color: colorFor(score), reasons };
}

// results: [{ title, url, domain, rd:Number|null,
//             locationMatch:Bool, isDedicated:Bool }]
// A "dedicated" site is one that looks purpose-built for this niche+city
// (the real competitors you'd have to outrank).
function scoreDomains(results, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (!results || results.length === 0) {
    return { score: 100, color: "green", reasons: ["No organic competitors found"] };
  }

  const dedicated = results.filter(r => r.isDedicated);
  const dedicatedRatio = dedicated.length / results.length;

  const withRd = results.filter(r => typeof r.rd === "number");
  const avgRd = withRd.length
    ? withRd.reduce((s, r) => s + r.rd, 0) / withRd.length
    : null;

  const dedicatedComponent = dedicatedRatio * 100;
  const rdComponent = avgRd == null
    ? 0
    : clamp((avgRd / t.rdThreshold) * 50, 0, 100);

  // If we have no RD data, lean entirely on the dedicated-site count.
  const competition = avgRd == null
    ? dedicatedComponent
    : 0.6 * dedicatedComponent + 0.4 * rdComponent;

  const score = Math.round(clamp(100 - competition, 0, 100));

  const reasons = [
    `${dedicated.length}/${results.length} results look like dedicated niche sites`,
    avgRd == null
      ? "No referring-domain data (install Ahrefs toolbar to enrich)"
      : `avg ${Math.round(avgRd)} referring domains (threshold ${t.rdThreshold})`,
  ];
  return { score, color: colorFor(score), reasons };
}

// Combined headline score: the average of the two, weighted toward map pack
// since local intent lives there.
function overallScore(mapPack, domains) {
  const parts = [];
  if (mapPack && typeof mapPack.score === "number") parts.push(mapPack.score * 0.6);
  if (domains && typeof domains.score === "number") parts.push(domains.score * 0.4);
  if (parts.length === 0) return { score: null, color: "gray" };
  // Renormalize weights based on what we actually have.
  const weightSum = (mapPack ? 0.6 : 0) + (domains ? 0.4 : 0);
  const score = Math.round(parts.reduce((s, p) => s + p, 0) / weightSum);
  return { score, color: colorFor(score) };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_THRESHOLDS, colorFor, scoreMapPack, scoreDomains, overallScore, clamp,
  };
}
