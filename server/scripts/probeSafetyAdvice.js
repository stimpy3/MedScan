// Temporary probe: inspect 1mg INITIAL_STATE for the Safety Advice section shape.
const { fetchDrugPage } = require("../services/enrichment.service");

function extractInitialState(html) {
  const s = html.indexOf("window.__INITIAL_STATE__ =");
  if (s < 0) return null;
  let i = html.indexOf("{", s), depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else { if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; } } } }
  }
  return null;
}

(async () => {
  const url = process.argv[2] || "https://www.1mg.com/drugs/dolo-650-tablet-74467";
  const page = await fetchDrugPage(url);
  if (!page.ok) { console.log("fetch failed", page.status); return; }
  const state = extractInitialState(page.html);
  const sd = state?.drugPageReducer?.staticData;
  if (!sd) { console.log("no staticData"); return; }
  console.log("staticData keys:", Object.keys(sd).join(", "));
  for (const k of Object.keys(sd)) {
    if (/safe|advi|warn|interact|caution|contra/i.test(k)) {
      console.log(`\n=== ${k} ===`);
      console.log(JSON.stringify(sd[k], null, 2).slice(0, 3000));
    }
  }
})();
