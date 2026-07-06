// server/scripts/backfillMedicineData.js
// Checkpointed, resumable backfill of missing medicine data from Tata 1mg (grounded, deterministic).
//
//   node scripts/backfillMedicineData.js --limit 40     enrich up to 40 not-yet-processed empty rows
//   node scripts/backfillMedicineData.js --all          enrich every remaining empty row
//   node scripts/backfillMedicineData.js --merge         join results into data/medicines.enriched.csv
//
// Results are appended to data/enrichment.results.ndjson (one JSON record per processed row). The run
// is resumable: on restart it skips ids already in that file, so Ctrl-C / a crash loses nothing.
// Never touches price / manufacturer / pack — only fills empty salt_composition/medicine_desc/side_effects.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const csv = require("csv-parser");
const { enrichMedicineFromWeb } = require("../services/enrichment.service");

const CSV_IN = path.join(__dirname, "../data/medicines.csv");
const CSV_OUT = path.join(__dirname, "../data/medicines.enriched.csv");
const RESULTS = path.join(__dirname, "../data/enrichment.results.ndjson");

// ── Politeness / anti-IP-block knobs ─────────────────────────────────────────
const DELAY_MIN = 1500;          // base gap between fetches (ms)
const DELAY_MAX = 3500;          // randomized up to this — avoids a robotic fixed interval
const BREAK_EVERY = 150;         // every N rows, take a longer breather
const BREAK_MS = 30000;          // length of that breather
const COOLDOWNS = [60000, 120000, 300000]; // escalating waits when 1mg pushes back (429/403/5xx)
const MAX_ROW_RETRIES = 3;       // give up on a row this run (it stays unrecorded → retried next run)
const MAX_CONSEC_BLOCKS = 6;     // stop the whole run if blocks persist (protects the IP; resume later)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = () => DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN));
// Transient = a server pushback / network blip we should wait out, NOT a real "no match".
const isTransient = reason => /^fetch_http_(429|403|5\d\d)$/.test(reason || "") || String(reason || "").startsWith("error_");

const isEmpty = row =>
  !((row.salt_composition || "").trim()) &&
  !((row.medicine_desc || "").trim()) &&
  !((row.side_effects || "").trim());

// Ids already processed (present in the results file) — for resume.
function loadProcessedIds() {
  return new Promise((resolve) => {
    const ids = new Set();
    if (!fs.existsSync(RESULTS)) return resolve(ids);
    const rl = readline.createInterface({ input: fs.createReadStream(RESULTS) });
    rl.on("line", (line) => { if (!line.trim()) return; try { ids.add(String(JSON.parse(line).id)); } catch {} });
    rl.on("close", () => resolve(ids));
  });
}

// Stream the CSV and collect up to `limit` empty, not-yet-processed rows ({id,name}).
function collectTargets(limit, processed) {
  return new Promise((resolve) => {
    const out = [];
    const stream = fs.createReadStream(CSV_IN).pipe(csv());
    stream.on("data", (row) => {
      if (out.length >= limit) { stream.destroy(); return; }
      if (row.id && row.name && isEmpty(row) && !processed.has(String(row.id))) {
        out.push({ id: String(row.id), name: row.name });
      }
    });
    stream.on("close", () => resolve(out));
    stream.on("end", () => resolve(out));
  });
}

async function runEnrich(limit) {
  const processed = await loadProcessedIds();
  console.log(`Already processed: ${processed.size}`);
  console.log(`Collecting up to ${limit} empty, unprocessed rows…`);
  const targets = await collectTargets(limit, processed);
  console.log(`Got ${targets.length} target(s). Politeness: ${DELAY_MIN}-${DELAY_MAX}ms jitter, break ${BREAK_MS / 1000}s every ${BREAK_EVERY}.\n`);

  const out = fs.createWriteStream(RESULTS, { flags: "a" });
  const tally = { found: 0, rejected: 0, skipped: 0, reasons: {} };
  let consecBlocks = 0;

  const finish = (note) => {
    if (note) console.log(`\n${note}`);
    console.log(`\n======== RUN SUMMARY ========`);
    console.log(`  enriched (found):   ${tally.found}`);
    console.log(`  not matched:        ${tally.rejected}  ${JSON.stringify(tally.reasons)}`);
    console.log(`  deferred (blocked): ${tally.skipped}  (unrecorded → retried next run)`);
    console.log(`  results file:       ${RESULTS}`);
    console.log(`=============================`);
    out.end(() => process.exit(0));
  };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    let attempt = 0, recorded = false;

    while (!recorded) {
      let r;
      try { r = await enrichMedicineFromWeb(t.name); }
      catch (e) { r = { found: false, reason: `error_${e.message}` }; }
      const reason = r.reason || "";

      // Treat as transient on the FIRST sight of a server-pushback / no-state (could be a soft block).
      const transient = isTransient(reason) || (reason === "no_initial_state" && attempt === 0);

      if (r.found || !transient) {
        const rec = { id: t.id, name: t.name, found: r.found, reason: r.reason || null,
          matchScore: r.matchScore ?? r.score ?? null, source: r.source || null,
          salt_composition: r.salt_composition || null, medicine_desc: r.medicine_desc || null,
          side_effects: r.side_effects || null, uses: r.uses || null,
          therapeutic_class: r.therapeutic_class || null, manufacturer: r.manufacturer || null };
        out.write(JSON.stringify(rec) + "\n");
        if (rec.found) tally.found++;
        else { tally.rejected++; tally.reasons[rec.reason] = (tally.reasons[rec.reason] || 0) + 1; }
        console.log(`[${i + 1}/${targets.length}] ${t.name}  →  ${rec.found ? `✅ ${rec.salt_composition || "(no comp)"}` : `❌ ${rec.reason}`}`);
        consecBlocks = 0; // a real page response (200) — not blocked
        recorded = true;
      } else {
        // Server pushed back — back off, do NOT record (so the row is retried later).
        attempt++;
        consecBlocks++;
        if (consecBlocks >= MAX_CONSEC_BLOCKS) {
          tally.skipped++;
          return finish(`🛑 ${consecBlocks} consecutive blocks — stopping to protect the IP. Re-run later to resume from here.`);
        }
        if (attempt > MAX_ROW_RETRIES) {
          tally.skipped++;
          console.log(`[${i + 1}/${targets.length}] ${t.name}  →  ⏭ deferred after ${MAX_ROW_RETRIES} tries (${reason})`);
          break; // leave unrecorded → retried next run
        }
        const cool = COOLDOWNS[Math.min(attempt - 1, COOLDOWNS.length - 1)];
        console.log(`[${i + 1}/${targets.length}] ${t.name}  →  ⚠ ${reason} — cooldown ${cool / 1000}s (attempt ${attempt}/${MAX_ROW_RETRIES})`);
        await sleep(cool);
      }
    }

    if (i < targets.length - 1) {
      if ((i + 1) % BREAK_EVERY === 0) { console.log(`   …breather ${BREAK_MS / 1000}s…`); await sleep(BREAK_MS); }
      else await sleep(jitter());
    }
  }

  finish();
}

// ── Merge: join NDJSON results into a full enriched CSV (fills only empty target columns) ─────
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function loadResults() {
  return new Promise((resolve) => {
    const map = new Map();
    if (!fs.existsSync(RESULTS)) return resolve(map);
    const rl = readline.createInterface({ input: fs.createReadStream(RESULTS) });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try { const r = JSON.parse(line); if (r.found) map.set(String(r.id), r); } catch {}
    });
    rl.on("close", () => resolve(map));
  });
}
async function runMerge() {
  const results = await loadResults();
  console.log(`Loaded ${results.size} enriched record(s). Writing ${CSV_OUT}…`);
  let headers = null, written = 0, filled = 0;
  const out = fs.createWriteStream(CSV_OUT);
  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_IN).pipe(csv())
      .on("headers", (h) => { headers = h; out.write(h.map(csvEscape).join(",") + "\n"); })
      .on("data", (row) => {
        const r = row.id && results.get(String(row.id));
        if (r) {
          // Fill ONLY empty target fields; never touch price/manufacturer/pack/etc.
          if (!((row.salt_composition || "").trim()) && r.salt_composition) { row.salt_composition = r.salt_composition; filled++; }
          if (!((row.medicine_desc || "").trim()) && r.medicine_desc) row.medicine_desc = r.medicine_desc;
          if (!((row.side_effects || "").trim()) && r.side_effects) row.side_effects = r.side_effects;
        }
        out.write(headers.map(h => csvEscape(row[h])).join(",") + "\n");
        written++;
      })
      .on("end", resolve).on("error", reject);
  });
  out.end();
  console.log(`\n✅ Wrote ${CSV_OUT}  (${written} rows, ${filled} compositions filled)`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes("--merge")) return runMerge();
  const all = args.includes("--all");
  const li = args.indexOf("--limit");
  const limit = all ? Infinity : (li >= 0 ? parseInt(args[li + 1], 10) : 40);
  await runEnrich(limit);
})();
