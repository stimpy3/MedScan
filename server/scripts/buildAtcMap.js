// server/scripts/buildAtcMap.js
// Builds data/atcMap.json — a flat { atcCode → official class name } map for every ATC code
// referenced by data/ingredientCodes.json (top-level atc[] and components[].atc[]), expanded
// with their 1/3/4-char prefixes. Names come from the RxNav RxClass API (same API family as
// buildIngredientCodes.js). Merges into any existing atcMap.json — hand-patched entries survive
// re-runs. Resumable: already-named codes are skipped.
//
// Usage:
//   node scripts/buildAtcMap.js                   fetch names for all missing codes
//   node scripts/buildAtcMap.js --curated-skeleton  print a skeleton for data/atcCurated.json
//                                                   (the 88 level-3 classes) and exit
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const CODES_INPUT = path.join(__dirname, "../data/ingredientCodes.json");
const OUTPUT = path.join(__dirname, "../data/atcMap.json");
const CURATED = path.join(__dirname, "../data/atcCurated.json");
const DELAY_MS = 150;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ATC codes here are 5-char level-4 codes (e.g. M01AB); meaningful prefixes are 1/3/4 chars.
function collectCodes() {
  const raw = JSON.parse(fs.readFileSync(CODES_INPUT, "utf8"));
  const codes = new Set();
  const add = c => {
    const code = String(c || "").trim().toUpperCase();
    if (!code) return;
    codes.add(code);
    for (const len of [1, 3, 4]) if (code.length > len) codes.add(code.slice(0, len));
  };
  for (const key in raw) {
    (raw[key].atc || []).forEach(add);
    (raw[key].components || []).forEach(comp => (comp.atc || []).forEach(add));
  }
  return [...codes].sort();
}

// 1/3-char class names come back ALL-CAPS from RxNav; title-case those, keep mixed-case as-is.
function normalizeName(name) {
  if (!name) return name;
  if (name !== name.toUpperCase()) return name;
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

async function fetchClassName(code) {
  const url = `https://rxnav.nlm.nih.gov/REST/rxclass/class/byId.json?classId=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const concepts = data.rxclassMinConceptList?.rxclassMinConcept || [];
  const atcConcept = concepts.find(c => String(c.classType || "").startsWith("ATC")) || concepts[0];
  return atcConcept?.className || null;
}

function printCuratedSkeleton(codes, map) {
  const level3 = codes.filter(c => c.length === 3);
  const skeleton = {};
  for (const code of level3) {
    skeleton[code] = { officialName: map[code] || "", friendlyLabel: "", commonUses: [] };
  }
  console.log(JSON.stringify(skeleton, null, 2));
  console.log(`\n// ${level3.length} level-3 classes — fill friendlyLabel/commonUses and save as ${path.relative(process.cwd(), CURATED)}`);
}

async function main() {
  const codes = collectCodes();
  let map = {};
  if (fs.existsSync(OUTPUT)) map = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));

  if (process.argv.includes("--curated-skeleton")) {
    printCuratedSkeleton(codes, map);
    return;
  }

  const pending = codes.filter(c => !map[c]);
  console.log(`📋 ${codes.length} codes total, ${codes.length - pending.length} already named, ${pending.length} to fetch\n`);

  const missing = [];
  let done = 0;
  for (const code of pending) {
    try {
      const name = await fetchClassName(code);
      if (name) {
        map[code] = normalizeName(name);
      } else {
        missing.push(code);
      }
    } catch (err) {
      console.log(`  ⚠ ${code}: ${err.message}`);
      missing.push(code);
    }
    done++;
    if (done % 25 === 0) {
      fs.writeFileSync(OUTPUT, JSON.stringify(map, null, 2));
      console.log(`  … ${done}/${pending.length}`);
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(map, null, 2));
  console.log(`\n✅ atcMap.json written: ${Object.keys(map).length} entries`);
  if (missing.length) {
    console.log(`❌ MISSING CODES (${missing.length}) — hand-patch into atcMap.json:`);
    console.log(missing.join(", "));
  } else {
    console.log("✅ No missing codes");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
