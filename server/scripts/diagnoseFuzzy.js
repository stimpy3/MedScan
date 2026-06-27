/**
 * diagnoseFuzzy.js
 *
 * Runs a set of realistic query variants through the extraction pipeline and
 * classifies each failure at the exact stage it broke:
 *
 *   STAGE 1 — FlexSearch returned 0 candidates (retrieval miss)
 *   STAGE 2 — Candidates found but all scored below threshold (ranking miss)
 *   PASS    — Correct medicine surfaced in top 5
 *
 * Run: node server/scripts/diagnoseFuzzy.js
 */

const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");
const { Document } = require("flexsearch");
const levenshtein = require("fast-levenshtein");

// ── Mirror the exact logic from medicineExtraction.service.js ────────────────

const IGNORE_WORDS = new Set([
  "i","me","my","myself","we","our","ours","ourselves","you","your","yours",
  "he","him","his","she","her","it","its","they","them","their","what","which",
  "who","whom","this","that","these","those","am","is","are","was","were","be",
  "been","being","have","has","had","having","do","does","did","doing","a","an",
  "the","and","but","if","or","because","as","until","while","of","at","by",
  "for","with","about","against","between","into","through","during","before",
  "after","above","below","to","from","up","down","in","out","on","off","over",
  "under","again","further","then","once","here","there","when","where","why",
  "how","all","any","both","each","few","more","most","other","some","such",
  "no","nor","not","only","own","same","so","than","too","very","s","t","can",
  "will","just","don","should","now",
  "want","need","get","take","check","find","search","show","list","give","tell",
  "explain","prescription","alternative","alternatives","substitute","substitutes",
  "compare","comparison","difference","versus","vs","schedule","remind","reminder",
  "reminders","med","meds","medicine","medicines","drug","drugs","pill","pills",
  "dose","doses","dosing","side","effect","effects","info","information","detail",
  "details","about",
  "tablet","tablets","tab","tabs","capsule","capsules","cap","caps",
  "syrup","syrups","syp","suspension","susp","injection","injections","inj",
  "drops","drop","ointment","cream","gel","lotion","inhaler","inhalers",
  "spray","sprays","powder","powders","solution","solutions",
  "infusion","infusions","vaccine","vaccines",
  "mg","mcg","ml","g","iu","units","unit",
]);

const FORM_WORDS = new Set([
  "tablet","tablets","tab","tabs","capsule","capsules","cap","caps",
  "syrup","syrups","syp","suspension","susp","injection","injections","inj",
  "drops","drop","ointment","cream","gel","lotion","inhaler","inhalers",
  "spray","sprays","powder","powders","solution","solutions",
  "infusion","infusions","vaccine","vaccines",
  "kit","forte","plus","ds","xr","er","sr","od","bd","tds","qid",
]);

const DOSAGE_RE = /^\d+(\.\d+)?(mg|mcg|ml|g|%|iu|units?|mm)?$/;

function extractBaseName(medicineName) {
  const tokens = medicineName.toLowerCase().trim().split(/\s+/);
  const base = tokens.filter(t => !FORM_WORDS.has(t) && !DOSAGE_RE.test(t));
  return base.length ? base.join(" ") : medicineName.toLowerCase();
}

const FILLER_WORDS = new Set([...IGNORE_WORDS].filter(w => !FORM_WORDS.has(w)));
function buildCleanQuery(text) {
  const normalized = text
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");
  const words = normalized.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.filter(w => !FILLER_WORDS.has(w)).join(" ");
}

function shouldIgnoreNgram(ngram) {
  const words = ngram.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every(w => IGNORE_WORDS.has(w) || FORM_WORDS.has(w) || DOSAGE_RE.test(w));
}

function escapeRegExp(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function charTrigrams(str) {
  const s = str.toLowerCase().trim();
  const tgs = new Set();
  for (let i = 0; i <= s.length - 3; i++) tgs.add(s.slice(i, i + 3));
  return tgs;
}

const TOKEN_WEIGHT = { base: 1.0, dose: 0.5, form: 0.25 };
function categorize(token) {
  if (DOSAGE_RE.test(token)) return "dose";
  if (FORM_WORDS.has(token)) return "form";
  return "base";
}
function doseNum(token) { const m = token.match(/^\d+(\.\d+)?/); return m ? m[0] : token; }
function tokenScore(a, ca, b, cb) {
  if (a === b) return 1;
  if (ca === "dose" || cb === "dose") return doseNum(a) === doseNum(b) ? 1 : 0;
  const maxLen = Math.max(a.length, b.length);
  const d = levenshtein.get(a, b);
  const thr = Math.max(1, Math.floor(maxLen * 0.3));
  return d <= thr ? 1 - d / maxLen : 0;
}
function directionalCoverage(from, to) {
  const used = new Array(to.length).fill(false);
  let matched = 0;
  for (const ft of from) {
    let bestS = 0, bestI = -1;
    for (let i = 0; i < to.length; i++) {
      if (used[i]) continue;
      const s = tokenScore(ft.t, ft.c, to[i].t, to[i].c);
      if (s > bestS) { bestS = s; bestI = i; }
    }
    if (bestI >= 0) { used[bestI] = true; matched += ft.w * bestS; }
  }
  const total = from.reduce((s, x) => s + x.w, 0);
  return total ? matched / total : 0;
}
function getSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  const qRaw = s1.split(/\s+/).filter(Boolean);
  const nRaw = s2.split(/\s+/).filter(Boolean);
  if (!qRaw.length || !nRaw.length) return 0;
  const q = qRaw.map(t => { const c = categorize(t); return { t, c, w: TOKEN_WEIGHT[c] }; });
  const n = nRaw.map(t => { const c = categorize(t); return { t, c, w: TOKEN_WEIGHT[c] }; });
  return directionalCoverage(q, n) * 0.7 + directionalCoverage(n, q) * 0.3;
}

const RELEVANCE_FLOOR = 0.5;

// ── Test cases ────────────────────────────────────────────────────────────────
// Format: { query, expectedSubstring }
// expectedSubstring is matched case-insensitively against medicine names
const TEST_CASES = [
  // Transpositions
  { query: "ambrodli",       expected: "ambrodil" },
  { query: "paractamol",     expected: "paracetamol" },
  { query: "amoxcilin",      expected: "amoxicillin" },
  { query: "cetirizne",      expected: "cetirizine" },
  { query: "metformni",      expected: "metformin" },
  { query: "atorvastatni",   expected: "atorvastatin" },

  // Dropped letters
  { query: "amoxclav",       expected: "amoxyclav" },
  { query: "amlodipne",      expected: "amlodipine" },
  { query: "azthromycin",    expected: "azithromycin" },
  { query: "panoprazole",    expected: "pantoprazole" },

  // Extra letters
  { query: "doloo",          expected: "dolo" },
  { query: "crocinn",        expected: "crocin" },
  { query: "augmentinn",     expected: "augmentin" },

  // Phonetic misspellings
  { query: "sefixime",       expected: "cefixime" },
  { query: "siprofloxacin",  expected: "ciprofloxacin" },
  { query: "levocetrizine",  expected: "levocetirizine" },

  // Short / truncated
  { query: "augment",        expected: "augmentin" },
  { query: "pantop",         expected: "pantoprazole" },
  { query: "cetriz",         expected: "cetirizine" },

  // Correct spellings (should always pass — baseline)
  { query: "dolo 650",       expected: "dolo" },
  { query: "crocin",         expected: "crocin" },
  { query: "amoxyclav 625",  expected: "amoxyclav" },
  { query: "metformin",      expected: "metformin" },
  { query: "pantoprazole",   expected: "pantoprazole" },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const index = new Document({ document: { id: "id", index: ["name"] }, tokenize: "forward" });
  const trigramIdx = new Map();
  const idToName = new Map();

  await new Promise((resolve, reject) => {
    const csvPath = path.join(__dirname, "..", "data", "medicines.csv");
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", row => {
        if (row.id && row.name) {
          const id = parseInt(row.id, 10);
          index.add({ id, name: row.name });
          idToName.set(id, row.name);
          // Build trigram index on base name
          const base = extractBaseName(row.name);
          for (const tg of charTrigrams(base)) {
            if (!trigramIdx.has(tg)) trigramIdx.set(tg, []);
            trigramIdx.get(tg).push(id);
          }
        }
      })
      .on("end", resolve)
      .on("error", reject);
  });

  function trigramLookup(query, limit = 20) {
    const qTgs = charTrigrams(query);
    const overlap = new Map();
    for (const tg of qTgs) {
      const ids = trigramIdx.get(tg);
      if (ids) for (const id of ids) overlap.set(id, (overlap.get(id) || 0) + 1);
    }
    return Array.from(overlap.entries()).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([id]) => id);
  }

  console.log(`\nLoaded ${idToName.size} medicines, ${trigramIdx.size} trigrams.\n`);
  console.log("=".repeat(72));

  const stats = { pass: 0, stage1: 0, stage2: 0 };
  const stage1Failures = [];
  const stage2Failures = [];

  for (const { query, expected } of TEST_CASES) {
    const normalized = query.replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/(\d)([a-zA-Z])/g, "$1 $2");
    const words = normalized.trim().split(/\s+/).filter(Boolean);

    // Build n-grams (same as service)
    const ngrams = new Set();
    for (let i = 0; i < words.length; i++) {
      ngrams.add(words[i]);
      if (i < words.length - 1) ngrams.add(`${words[i]} ${words[i+1]}`);
      if (i < words.length - 2) ngrams.add(`${words[i]} ${words[i+1]} ${words[i+2]}`);
      if (i < words.length - 3) ngrams.add(`${words[i]} ${words[i+1]} ${words[i+2]} ${words[i+3]}`);
    }

    const candidateMap = new Map(); // id → name (retrieval only)

    // Primary: FlexSearch — collect candidate ids
    for (const ngram of ngrams) {
      if (shouldIgnoreNgram(ngram)) continue;
      const results = index.search(ngram, 10);
      if (results && results[0]?.result?.length) {
        for (const id of results[0].result) {
          const name = idToName.get(id);
          if (name && !candidateMap.has(id)) candidateMap.set(id, name);
        }
      }
    }

    let usedTrigram = false;

    // Fallback: trigram index (only when FlexSearch found nothing)
    if (candidateMap.size === 0) {
      usedTrigram = true;
      for (const ngram of ngrams) {
        if (shouldIgnoreNgram(ngram)) continue;
        for (const id of trigramLookup(ngram, 20)) {
          const name = idToName.get(id);
          if (name && !candidateMap.has(id)) candidateMap.set(id, name);
        }
      }
    }

    const rawCandidateCount = candidateMap.size;

    // Score every candidate ONCE against the clean query, keep above the relevance floor (same as service)
    const cleanQuery = buildCleanQuery(query);
    const above = Array.from(candidateMap.entries())
      .map(([id, name]) => ({ name, sim: getSimilarity(cleanQuery, name) }))
      .filter(c => c.sim >= RELEVANCE_FLOOR)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5);

    const found = above.some(c => c.name.toLowerCase().includes(expected.toLowerCase()));

    if (rawCandidateCount === 0) {
      stats.stage1++;
      stage1Failures.push({ query, expected });
      console.log(`❌ STAGE 1  "${query}"  →  expected "${expected}"  (both FlexSearch and trigram: 0 candidates)`);
    } else if (!found) {
      stats.stage2++;
      const topRaw = Array.from(candidateMap.entries())
        .map(([id, name]) => ({ name, sim: getSimilarity(buildCleanQuery(query), name) }))
        .sort((a,b) => b.sim - a.sim).slice(0, 3);
      stage2Failures.push({ query, expected, topRaw });
      console.log(`⚠️  STAGE 2  "${query}"  →  expected "${expected}"`);
      console.log(`            Retrieved ${rawCandidateCount} raw, but target didn't survive the relevance floor.`);
      console.log(`            Top 3 raw: ${topRaw.map(c => `${c.name}(${c.sim.toFixed(3)})`).join(", ")}`);
    } else {
      stats.pass++;
      const match = above.find(c => c.name.toLowerCase().includes(expected.toLowerCase()));
      const rank = above.indexOf(match) + 1;
      const via = usedTrigram ? " [trigram]" : "";
      console.log(`✅ PASS     "${query}"  →  "${match.name}" (rank ${rank}, score ${match.sim.toFixed(3)})${via}`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`\nSUMMARY  (${TEST_CASES.length} test cases)`);
  console.log(`  ✅ Pass:              ${stats.pass}  (${pct(stats.pass)}%)`);
  console.log(`  ❌ Stage 1 (retrieval miss): ${stats.stage1}  (${pct(stats.stage1)}%) — FlexSearch returned 0`);
  console.log(`  ⚠️  Stage 2 (ranking miss):  ${stats.stage2}  (${pct(stats.stage2)}%) — candidates found but scored out`);

  if (stage1Failures.length) {
    console.log(`\nStage 1 failures (retrieval — FlexSearch returned nothing):`);
    stage1Failures.forEach(f => console.log(`  "${f.query}"  (expected: ${f.expected})`));
  }
  if (stage2Failures.length) {
    console.log(`\nStage 2 failures (ranking — candidate existed but didn't score high enough):`);
    stage2Failures.forEach(f => {
      console.log(`  "${f.query}"  (expected: ${f.expected})`);
      console.log(`    Top raw: ${f.topRaw.map(c => `${c.name}(${c.sim.toFixed(3)})`).join(", ")}`);
    });
  }

  console.log("");

  function pct(n) { return ((n / TEST_CASES.length) * 100).toFixed(0); }
}

main().catch(console.error);
