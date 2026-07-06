// server/scripts/enrichSample.js
// Feasibility/accuracy gate for the enrichment plan: runs enrichMedicineFromWeb over a few
// medicines and prints the 1mg source + extracted fields, then a summary tally.
// Extraction is deterministic (parsed from 1mg's INITIAL_STATE) — no LLM/Groq tokens — so pacing
// is only 1mg politeness.
//
// Usage:
//   node scripts/enrichSample.js                      → built-in mix (known + empty-from-CSV)
//   node scripts/enrichSample.js "Dolo 650" "Ecosprin 75"   → specific names
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { enrichMedicineFromWeb } = require("../services/enrichment.service");

const KNOWN = ["Dolo 650 Tablet", "Augmentin 625 Duo Tablet", "Azithral 500 Tablet"];
const DELAY_MS = 4000; // be polite to 1mg between medicines
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findEmptyRows(limit) {
  return new Promise((resolve) => {
    const found = [];
    const stream = fs.createReadStream(path.join(__dirname, "../data/medicines.csv")).pipe(csv());
    stream.on("data", (row) => {
      if (found.length >= limit) { stream.destroy(); return; }
      const empty = !((row.salt_composition || "").trim()) &&
                    !((row.medicine_desc || "").trim()) &&
                    !((row.side_effects || "").trim());
      if (row.name && empty) found.push(row.name);
    });
    stream.on("close", () => resolve(found));
    stream.on("end", () => resolve(found));
  });
}

(async () => {
  const cliNames = process.argv.slice(2);
  let names;
  if (cliNames.length) {
    names = cliNames;
  } else {
    const empties = await findEmptyRows(3);
    names = [...KNOWN, ...empties];
    console.log(`Built-in sample: ${KNOWN.length} known + ${empties.length} empty-from-CSV\n`);
  }

  let foundCount = 0, fieldsFilled = 0;
  const FIELDS = ["salt_composition", "medicine_desc", "side_effects", "uses"];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    console.log(`\n[${i + 1}/${names.length}] ===== ${name} =====`);
    const t0 = Date.now();
    const r = await enrichMedicineFromWeb(name);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (!r.found) {
      console.log(`  ❌ not enriched (${r.reason})  source=${r.source || "none"}  [${secs}s]`);
    } else {
      foundCount++;
      fieldsFilled += FIELDS.filter(k => r[k]).length;
      console.log(`  ✅ source: ${r.source}  [${secs}s]   (matched: ${r.matchedName})`);
      console.log(`     salt_composition: ${r.salt_composition || "—"}`);
      console.log(`     uses:             ${r.uses || "—"}`);
      console.log(`     side_effects:     ${(r.side_effects || "—").slice(0, 180)}`);
      console.log(`     therapeutic:      ${r.therapeutic_class || "—"}   mfr: ${r.manufacturer || "—"}`);
      console.log(`     medicine_desc:    ${(r.medicine_desc || "—").slice(0, 160)}`);
    }

    if (i < names.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n========================================`);
  console.log(`SUMMARY`);
  console.log(`  medicines tried:    ${names.length}`);
  console.log(`  1mg page found:     ${foundCount}`);
  console.log(`  fields filled:      ${fieldsFilled} (of ${names.length * FIELDS.length} possible)`);
  console.log(`========================================`);
})();
