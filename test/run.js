// Minimal dependency-free test runner (jsdom for DOM fixtures).
// Run with: npm test
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const parser = require("../src/parser.js");
const scoring = require("../src/scoring.js");
const uule = require("../src/uule.js");
// In the extension, cities.js and turbo.js are separate content scripts sharing
// one global scope, so turbo.js sees the CITIES global directly. Recreate that
// for Node by exposing it as a global before turbo's functions run.
global.CITIES = require("../src/cities.js").CITIES;
const turbo = require("../src/turbo.js");

let passed = 0, failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error("  ✗ " + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}
function section(name) { console.log("\n" + name); }

function loadFixture(file) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8");
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  // parseMapPack uses NodeFilter (a browser global); expose jsdom's.
  global.NodeFilter = dom.window.NodeFilter;
  return dom.window.document;
}

// ---- parser: query splitting ----
section("parser.splitQuery");
eq(parser.splitQuery("towing tampa, fl").keyword, "towing", "keyword from comma query");
eq(parser.splitQuery("towing tampa, fl").location, "tampa, fl", "location from comma query");
eq(parser.splitQuery("concrete driveway austin, tx").keyword, "concrete driveway", "multi-word keyword");
eq(parser.splitQuery("towing tampa").location, "tampa", "no-comma location guess");

// ---- parser: location matching ----
section("parser.matchesLocation");
ok(parser.matchesLocation("Frontline Towing Tampa", "Tampa, FL"), "city in name matches");
ok(!parser.matchesLocation("Frontline Towing", "Tampa, FL"), "no city -> no match");

// ---- parser: crowded fixture ----
section("parser: crowded market");
{
  const doc = loadFixture("crowded.html");
  const mp = parser.parseMapPack("Tampa, FL", doc);
  eq(mp.length, 3, "3 map-pack listings detected");
  const names = mp.map((l) => l.name);
  ok(names.includes("Frontline Towing"), "listing name extracted (not the rating badge)");
  ok(names.includes("Tampa Towing Company"), "second listing name extracted");
  const tampa = mp.find((l) => l.name === "Tampa Towing Company");
  eq(tampa.reviews, 235, "review count parsed");
  eq(tampa.rating, 4.8, "rating parsed");
  ok(tampa.locationMatch, "Tampa listing flagged as city match");
  ok(mp.every((l) => l.hasWebsite), "all crowded listings have websites");
  ok(mp.some((l) => l.phone && l.phone.includes("214-2958")), "phone parsed");

  const org = parser.parseOrganic("towing", "Tampa, FL", 30, doc);
  eq(org.length, 4, "4 organic results (deduped by domain)");
  const dedicated = org.filter((r) => r.isDedicated).map((r) => r.domain);
  ok(dedicated.includes("towingtampa.com"), "keyword+geo domain flagged dedicated");
  ok(!org.find((r) => r.domain === "yelp.com").isDedicated, "directory not flagged dedicated");
  eq(org.find((r) => r.domain === "towingtampa.com").rd, 45, "Ahrefs RD badge read");

  const mpScore = scoring.scoreMapPack(mp);
  const domScore = scoring.scoreDomains(org);
  ok(mpScore.score < 40 && mpScore.color === "red", `crowded map pack scores red (${mpScore.score})`);
  ok(domScore.score <= 60, `crowded domains score low-ish (${domScore.score})`);
}

// ---- parser: opportunity fixture ----
section("parser: opportunity market");
{
  const doc = loadFixture("opportunity.html");
  const mp = parser.parseMapPack("Brandon, FL", doc);
  eq(mp.length, 1, "1 map-pack listing");
  eq(mp[0].hasWebsite, false, "listing has no website (opportunity)");
  eq(mp[0].reviews, 3, "low review count parsed");

  const org = parser.parseOrganic("towing", "Brandon, FL", 30, doc);
  eq(org.filter((r) => r.isDedicated).length, 0, "no dedicated competitors");

  const mpScore = scoring.scoreMapPack(mp);
  const domScore = scoring.scoreDomains(org);
  const overall = scoring.overallScore(mpScore, domScore);
  ok(mpScore.score >= 70 && mpScore.color === "green", `open map pack scores green (${mpScore.score})`);
  ok(domScore.score >= 90, `thin organic scores high (${domScore.score})`);
  ok(overall.score >= 70, `overall opportunity is green (${overall.score})`);
}

// ---- parser: real local pack (stars between rating & reviews, phones) ----
section("parser: local pack with star glyphs + phones");
{
  const doc = loadFixture("local_stars_phones.html");
  const mp = parser.parseMapPack("Midlothian, TX", doc);
  eq(mp.length, 3, "3 local listings detected despite star glyphs");
  const names = mp.map((l) => l.name);
  ok(names.includes("Open Road Towing"), "name parsed (not '5.0' or 'Businesses')");
  const dw = mp.find((l) => /D&W/.test(l.name));
  ok(dw, "D&W row detected");
  eq(dw.reviews, 85, "review count parsed across the star gap");
  eq(dw.rating, 4.5, "rating parsed");
  eq(dw.hasWebsite, false, "D&W flagged no-website (only Directions)");
  const open = mp.find((l) => l.name === "Open Road Towing");
  eq(open.reviews, 2, "small review count parsed");
  ok(open.phone && open.phone.includes("293-4750"), "phone parsed, not mistaken for reviews");
  ok(mp.every((l) => l.reviews < 1000), "phone numbers never parsed as review counts");
  ok(mp.every((l) => l.locationMatch), "all rows match the city");
}

// ---- parser: aria-only review counts + Directions (real towing case) ----
section("parser: local pack with aria-only reviews + Directions");
{
  const doc = loadFixture("local_aria_directions.html");
  const mp = parser.parseMapPack("Midlothian, TX", doc);
  eq(mp.length, 3, "3 local rows detected via rating + Directions (no literal parens)");
  const names = mp.map((l) => l.name).join(" | ");
  ok(/Open Road Towing/.test(names), "Open Road detected");
  ok(/J&S Towing/.test(names), "J&S detected");
  ok(!/YELP|BEST 10/i.test(names), "organic Yelp result excluded from map pack");
  const dw = mp.find((l) => /D&W/.test(l.name));
  eq(dw.reviews, 85, "review count read from aria-label");
  eq(dw.rating, 4.5, "rating read from visible text");
  const open = mp.find((l) => l.name === "Open Road Towing");
  eq(open.reviews, 2, "aria review count parsed for Open Road");
  eq(open.hasWebsite, true, "Open Road has a website");
  const mpScore = scoring.scoreMapPack(mp);
  // Mixed market (one 85-review incumbent, two near-zero) -> a moderate score,
  // not the misleading 0 it used to produce.
  ok(mpScore.score > 30 && mpScore.score < 70, `moderate market scores yellow-ish (${mpScore.score})`);
}

// ---- parser: no local pack, but organic + ads have review snippets ----
section("parser: no local pack (organic/ads present)");
{
  const doc = loadFixture("no_localpack_ads.html");
  const mp = parser.parseMapPack("Midlothian, TX", doc);
  eq(mp.length, 0, "no 'Businesses' heading -> no map pack (organic/ads ignored)");
  const mpScore = scoring.scoreMapPack(mp);
  eq(mpScore.score, 100, "no local competition -> wide-open opportunity");
  // Organic still parses (the real competition lives here).
  const org = parser.parseOrganic("asbestos", "Midlothian, TX", 30, doc);
  ok(org.length >= 2, "organic results still parsed");
}

// ---- parser: no map pack ----
section("parser: no map pack");
{
  const doc = loadFixture("no_mappack.html");
  const mp = parser.parseMapPack("Anywhere, US", doc);
  eq(mp.length, 0, "no map pack -> empty array");
  const mpScore = scoring.scoreMapPack(mp);
  eq(mpScore.score, 100, "empty map pack -> wide-open score 100");
  const org = parser.parseOrganic("towing", "Anywhere", 30, doc);
  eq(org.length, 2, "organic still parsed without a map pack");
}

// ---- uule ----
section("uule");
eq(uule.canonicalName("Tampa", "FL"), "Tampa,Florida,United States", "canonical name built");
{
  const u = uule.encodeUULE("Tampa,Florida,United States");
  ok(u.startsWith("w+CAIQICI"), "uule has correct prefix");
  const decoded = Buffer.from(u.slice(10), "base64").toString("utf8");
  eq(decoded, "Tampa,Florida,United States", "uule base64 round-trips");
  const url = uule.buildSearchUrl("towing", { city: "Clearwater", state: "FL" }, true);
  ok(url.includes("uule=") && url.includes("gl=us"), "spoofed URL carries uule + gl");
  const plain = uule.buildSearchUrl("towing", { city: "Clearwater", state: "FL" }, false);
  ok(!plain.includes("uule="), "geoSpoof off -> no uule param");
}

// ---- turbo ----
section("turbo");
{
  const origin = turbo.findCity("Tampa, FL");
  ok(origin && origin.name === "Tampa" && origin.state === "FL", "origin city resolved");
  const near = turbo.nearbyCities(origin, { distanceMiles: 25, popMin: 50000, popMax: 500000, limit: 10 });
  ok(near.length > 0, "nearby cities found in 25mi/50k-500k band");
  ok(near.every((c) => c.pop >= 50000 && c.pop <= 500000), "population filter respected");
  ok(near.every((c) => c.distance <= 25), "distance filter respected");
  for (let i = 1; i < near.length; i++) ok(near[i].distance >= near[i - 1].distance, "sorted by distance");
  eq(turbo.findCity("Springfield").name, "Springfield", "bare city resolves to largest match");
}

console.log(`\n${failed === 0 ? "✓ PASS" : "✗ FAIL"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
