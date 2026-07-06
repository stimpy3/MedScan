// server/services/lazyEnrichment.service.js
// On-demand ("lazy") enrichment for medicines whose CSV row is missing data. Runs ONLY when a
// user actually asks about a medicine and fields are empty — no ahead-of-time backfill needed.
//
//   Round 0  (free, deterministic): offline 1mg index → page fetch → INITIAL_STATE parse.
//            Reuses enrichment.service — no Serper, no LLM. Resolves most misses.
//   Round 1  (only if round 0 leaves gaps): LLM builds a focused query (locked to site:1mg.com)
//            → Serper search → fetch + deterministically parse any 1mg drug pages found;
//            search snippets are used only as a last resort.
//   Round 2  (only if gaps remain AND round 1 looked relevant): narrower query targeting just
//            the leftover gaps, same processing.
//
// Guarantees:
//   - fills ONLY fields that were missing — never overwrites existing CSV data
//   - every fact traces to a fetched 1mg page (or, at worst, a 1mg search snippet); the LLM
//     never authors medical facts, and when nothing usable is found we say so, never fabricate
//   - positive results are cached (data/lazyEnrichment.cache.ndjson) so repeats never refetch
const fs = require("fs");
const path = require("path");
const { enrichMedicineFromWeb, parseDrugPage, fetchDrugPage } = require("./enrichment.service");
const { normKey } = require("./oneMgMatch.service");
const { getSimilarity } = require("./medicineExtraction.service");
const { searchSerper } = require("./serper.service");
const { chatCompletionJson } = require("./groq.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");
const {
  LAZY_QUERY_BUILDER_PROMPT,
  LAZY_GAP_CHECK_PROMPT,
  LAZY_SNIPPET_EXTRACT_PROMPT
} = require("../prompts/lazyEnrich.prompt");

const CACHE_FILE = path.join(__dirname, "../data/lazyEnrichment.cache.ndjson");
const FIELDS = ["salt_composition", "medicine_desc", "side_effects"];
// Structured 1mg-only fields for the personalized safety layer. Opt-in (opts.includeSafety):
// only fetched when the requester has a health profile, so profile-less behavior is unchanged.
// These come ONLY from the deterministic page parse — never from Serper snippets or the LLM.
const SAFETY_FIELDS = ["safety_advice", "drug_interactions"];
const FIELD_KEYWORDS = { salt_composition: "salt composition", medicine_desc: "uses", side_effects: "side effects" };
const VERIFY_SCORE = 0.80;            // same post-fetch name re-check floor as the backfill path
const MAX_PAGE_FETCHES_PER_ROUND = 2; // polite: at most 2 page fetches per search round

let cache = null;                  // normKey(name) → cached positive record
const negativeThisRun = new Set(); // known-misses this server run — don't respend Serper on them

function loadCache() {
  if (cache) return cache;
  cache = new Map();
  try {
    for (const line of fs.readFileSync(CACHE_FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.found && r.key) cache.set(r.key, r); } catch {}
    }
    console.log(`[LazyEnrich] cache loaded: ${cache.size} record(s)`);
  } catch {} // no cache file yet — fine
  return cache;
}

function saveToCache(rec) {
  loadCache().set(rec.key, rec);
  try { fs.appendFileSync(CACHE_FILE, JSON.stringify(rec) + "\n"); }
  catch (e) { console.error("[LazyEnrich] cache write failed:", e.message); }
}

// Field presence that works for strings AND the structured safety fields (object / array).
function hasValue(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return String(v).trim().length > 0;
}

// Which of the enrichable fields are empty on this record (null record = all of them).
function missingFieldsOf(record, includeSafety = false) {
  const wanted = includeSafety ? [...FIELDS, ...SAFETY_FIELDS] : FIELDS;
  if (!record) return [...wanted];
  return wanted.filter(f => !hasValue(record[f]));
}

const stillMissing = (collected, missing) => missing.filter(f => !hasValue(collected[f]));

// Merge a parsed 1mg page into `collected` — ONLY for fields in `missing`, never overwriting.
function mergeParsed(parsed, collected, missing) {
  const vals = {
    salt_composition: parsed.salt_composition,
    medicine_desc: parsed.medicine_desc || parsed.uses,
    side_effects: parsed.side_effects,
    safety_advice: parsed.safety_advice,
    drug_interactions: parsed.drug_interactions
  };
  let merged = false;
  for (const f of missing) {
    if (!hasValue(collected[f]) && hasValue(vals[f])) { collected[f] = vals[f]; merged = true; }
  }
  return merged;
}

async function llmJson(systemPrompt, payload) {
  const responseText = await chatCompletionJson([
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(payload, null, 2) }
  ]);
  return JSON.parse(cleanLlmJsonResponse(responseText));
}

// Prompt 1 — query builder. The site lock is enforced HERE, not trusted to the LLM.
async function buildQuery(name, gaps, round, previousQuery, hint) {
  let q = "";
  try {
    const out = await llmJson(LAZY_QUERY_BUILDER_PROMPT, {
      medicineName: name,
      missingFields: gaps.map(f => FIELD_KEYWORDS[f]),
      round,
      previousQuery: previousQuery || null,
      hint: hint || null
    });
    q = String(out.query || "").trim();
  } catch (e) {
    console.error("[LazyEnrich] query builder LLM failed:", e.message);
  }
  if (!q) q = `"${name}" ${gaps.map(f => FIELD_KEYWORDS[f]).join(" ")}`; // deterministic fallback
  q = q.replace(/site:\S+/gi, "").replace(/\s+/g, " ").trim();
  return `${q} site:1mg.com`;
}

// Prompt 2 — gap check: was this round about the right medicine, and what to try next?
// (What's still missing is computed deterministically — the LLM only judges relevance.)
async function gapCheck(name, requested, collected, results) {
  try {
    const out = await llmJson(LAZY_GAP_CHECK_PROMPT, {
      medicineName: name,
      requestedFields: requested,
      collected: Object.fromEntries(requested.map(f => [f, collected[f] || null])),
      searchResults: results.slice(0, 5).map(r => ({ title: r.title, snippet: r.snippet }))
    });
    return { relevant: out.relevant !== false, hint: typeof out.hint === "string" ? out.hint : null };
  } catch (e) {
    console.error("[LazyEnrich] gap check LLM failed:", e.message);
    return { relevant: true, hint: null }; // permissive: one more focused try is cheap
  }
}

// Process one Serper round: prefer fetching + deterministically parsing 1mg drug pages
// (same guards as the backfill path); fall back to snippet extraction only for leftover gaps.
async function harvestRound(name, results, collected, missing, sources, fetchedUrls) {
  const drugLinks = results
    .map(r => r.link)
    .filter(l => /^https?:\/\/(www\.)?1mg\.com\/drugs\//i.test(l) && !fetchedUrls.has(l))
    .slice(0, MAX_PAGE_FETCHES_PER_ROUND);

  for (const url of drugLinks) {
    fetchedUrls.add(url);
    try {
      const page = await fetchDrugPage(url);
      if (!page.ok) continue;
      const parsed = parseDrugPage(page.html, url);
      if (!parsed) continue;
      // Precision guard: the page's canonical name must still resemble what we asked for.
      if (getSimilarity(normKey(name), normKey(parsed.matchedName || "")) < VERIFY_SCORE) {
        console.log(`[LazyEnrich] rejected ${url} (name verify failed: "${parsed.matchedName}")`);
        continue;
      }
      if (mergeParsed(parsed, collected, missing) && !sources.includes(url)) sources.push(url);
      if (!stillMissing(collected, missing).length) return;
    } catch (e) {
      console.error(`[LazyEnrich] page fetch failed ${url}:`, e.message);
    }
  }

  // Prompt 3 — snippets as last resort. The LLM may ONLY echo facts present in the snippets.
  // Safety fields are excluded: they exist only as deterministic page parses, never snippet text.
  const gaps = stillMissing(collected, missing).filter(f => FIELDS.includes(f));
  if (!gaps.length || !results.length) return;
  try {
    const top = results.slice(0, 4);
    const out = await llmJson(LAZY_SNIPPET_EXTRACT_PROMPT, { medicineName: name, missingFields: gaps, results: top });
    let used = false;
    for (const f of gaps) {
      const v = typeof out[f] === "string" ? out[f].trim() : "";
      if (v && v.toLowerCase() !== "null") { collected[f] = v; used = true; }
    }
    if (used) for (const r of top) if (r.link && !sources.includes(r.link)) sources.push(r.link);
  } catch (e) {
    console.error("[LazyEnrich] snippet extract LLM failed:", e.message);
  }
}

// Main entry. `existingRecord` = whatever we already have (a CSV record or a compare column);
// only its EMPTY fields are ever fetched/filled. Returns null when nothing is missing,
// otherwise { found, fields: {only-the-filled-fields}, sources: [1mg urls] }. Never throws.
// opts.includeSafety additionally requests safety_advice + drug_interactions (profile users only).
async function lazyEnrichFields(name, existingRecord, opts = {}) {
  const includeSafety = !!opts.includeSafety;
  const missing = missingFieldsOf(existingRecord, includeSafety);
  if (!missing.length) return null;

  const key = normKey(name);
  const cached = loadCache().get(key);
  if (cached) {
    // Pre-safety-layer cache rows were never parsed for safety fields. When a safety-aware
    // request hits one, upgrade it: one deterministic round-0 refetch, then mark it parsed
    // (safetyParsed) so a page genuinely lacking the section isn't refetched forever.
    if (includeSafety && !cached.safetyParsed) {
      try {
        const r0 = await enrichMedicineFromWeb(name);
        if (r0.found) {
          const upgraded = { ...cached.fields };
          for (const f of SAFETY_FIELDS) {
            const v = f === "safety_advice" ? r0.safety_advice : r0.drug_interactions;
            if (!hasValue(upgraded[f]) && hasValue(v)) upgraded[f] = v;
          }
          cached.fields = upgraded;
          if (r0.source && !(cached.sources || []).includes(r0.source)) {
            cached.sources = [...(cached.sources || []), r0.source];
          }
        }
        cached.safetyParsed = true;
        saveToCache(cached); // appended line wins on next load
        console.log(`[LazyEnrich] "${name}" cache upgraded with safety fields`);
      } catch (e) {
        console.error(`[LazyEnrich] safety upgrade failed for "${name}":`, e.message);
      }
    }
    console.log(`[LazyEnrich] "${name}" served from cache`);
    return { found: true, fields: cached.fields || {}, sources: cached.sources || [], cached: true };
  }
  if (negativeThisRun.has(key)) return { found: false, fields: {}, sources: [] };

  console.log(`[LazyEnrich] "${name}" missing [${missing.join(", ")}] — enriching on demand`);
  const collected = {};
  const sources = [];
  const fetchedUrls = new Set();

  // Collection list: whatever the caller is missing PLUS the safety fields opportunistically —
  // if a page is being fetched anyway, its deterministic safety parse is free and cache-worthy.
  const collect = [...new Set([...missing, ...SAFETY_FIELDS.filter(f => !hasValue(existingRecord?.[f]))])];

  // ── Round 0: offline 1mg index + deterministic page parse (no Serper, no LLM) ──
  try {
    const r0 = await enrichMedicineFromWeb(name);
    if (r0.found) {
      if (r0.source) fetchedUrls.add(r0.source);
      if (mergeParsed(r0, collected, collect) && r0.source) sources.push(r0.source);
      console.log(`[LazyEnrich] round 0 hit (score ${r0.matchScore})`);
    } else {
      console.log(`[LazyEnrich] round 0 miss (${r0.reason})`);
    }
  } catch (e) {
    console.error("[LazyEnrich] round 0 failed:", e.message);
  }

  // ── Rounds 1–2: Serper fallback, only for what's still missing ──
  // Text fields only: safety fields are deterministic-parse-only, so they never justify a search.
  const textMissing = missing.filter(f => FIELDS.includes(f));
  let gaps = stillMissing(collected, textMissing);
  if (gaps.length && process.env.SERPER_API_KEY) {
    try {
      const q1 = await buildQuery(name, gaps, 1);
      console.log(`[LazyEnrich] round 1 query: ${q1}`);
      const results1 = await searchSerper(q1);
      await harvestRound(name, results1, collected, collect, sources, fetchedUrls);

      gaps = stillMissing(collected, textMissing);
      if (gaps.length && results1.length) {
        const check = await gapCheck(name, textMissing, collected, results1);
        if (check.relevant) {
          const q2 = await buildQuery(name, gaps, 2, q1, check.hint);
          console.log(`[LazyEnrich] round 2 query: ${q2}`);
          const results2 = await searchSerper(q2);
          await harvestRound(name, results2, collected, collect, sources, fetchedUrls);
        } else {
          console.log("[LazyEnrich] round 1 results not relevant — skipping round 2");
        }
      }
    } catch (e) {
      console.error("[LazyEnrich] web search rounds failed:", e.message);
    }
  }

  const found = Object.keys(collected).length > 0;
  if (found) {
    // safetyParsed records whether round 0 ran with safety parsing in effect — the parse now always
    // extracts safety fields, so any fresh page fetch counts; only pure-snippet results don't.
    saveToCache({ key, name, found: true, fields: collected, sources, safetyParsed: fetchedUrls.size > 0, at: new Date().toISOString() });
  } else {
    negativeThisRun.add(key);
    console.log(`[LazyEnrich] "${name}" — nothing usable found after all rounds; not fabricating`);
  }
  return { found, fields: collected, sources };
}

module.exports = { lazyEnrichFields, missingFieldsOf };
