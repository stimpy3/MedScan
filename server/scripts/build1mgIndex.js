// server/scripts/build1mgIndex.js
// One-time (refreshable) discovery index for enrichment. Downloads 1mg's static drug sitemaps and
// builds data/1mg_index.json mapping a normalized medicine name -> { url, id }. This replaces the
// per-query 1mg search API (which IP-throttles after a few calls) with an offline lookup that never
// rate-limits. Re-run occasionally to refresh.
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const OUT = path.join(__dirname, "../data/1mg_index.json");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const get = (url) => axios.get(url, { headers: { "User-Agent": UA }, timeout: 30000, validateStatus: () => true, maxContentLength: 1e9 });
const locs = xml => [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1]);

// "dolo 650 tablet" key from "/drugs/dolo-650-tablet-74467"
function normFromUrl(url) {
  const slug = (url.split("/drugs/")[1] || "").replace(/-\d+$/, "");
  return slug.replace(/-/g, " ").replace(/[^a-z0-9 ]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function idFromUrl(url) { const m = url.match(/-(\d+)\s*$/); return m ? m[1] : null; }

(async () => {
  console.log("Fetching sitemap index…");
  const index = await get("https://www.1mg.com/sitemap.xml");
  if (index.status !== 200) { console.error("sitemap.xml failed:", index.status); process.exit(1); }
  const drugSitemaps = locs(index.data).filter(u => /sitemap_drugs_\d+\.xml/i.test(u));
  console.log(`Found ${drugSitemaps.length} drug sitemaps`);

  const map = {};
  let total = 0, collisions = 0;
  for (let i = 0; i < drugSitemaps.length; i++) {
    const sm = drugSitemaps[i];
    const r = await get(sm);
    if (r.status !== 200) { console.log(`  [${i + 1}/${drugSitemaps.length}] ${sm} → HTTP ${r.status}, skipping`); continue; }
    const urls = locs(r.data);
    for (const u of urls) {
      const key = normFromUrl(u);
      if (!key) continue;
      total++;
      if (map[key]) { collisions++; continue; } // first wins
      map[key] = { url: u, id: idFromUrl(u) };
    }
    console.log(`  [${i + 1}/${drugSitemaps.length}] ${sm} → ${urls.length} urls (running keys: ${Object.keys(map).length})`);
    await sleep(800); // polite
  }

  fs.writeFileSync(OUT, JSON.stringify(map));
  console.log(`\n✅ Wrote ${OUT}`);
  console.log(`   unique keys: ${Object.keys(map).length}  (total urls seen: ${total}, dup keys: ${collisions})`);
})();
