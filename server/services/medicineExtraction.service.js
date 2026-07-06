const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Document } = require("flexsearch");
const levenshtein = require("fast-levenshtein");
const { chatCompletionJson, chatCompletionJsonSmart } = require("./groq.service");
const { SYSTEM_PROMPT } = require("../prompts/medicineExtraction.prompt");
const { COMPARE_VALIDATE_SYSTEM_PROMPT } = require("../prompts/compareValidate.prompt");
const { cleanLlmJsonResponse } = require("../utils/helpers");

// ── Stop words for query n-gram filtering ────────────────────────────────────
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
  // dosage units — never standalone medicine names
  "mg","mcg","ml","g","iu","iu","units","unit",
]);

// ── Form/dosage words stripped from medicine names before fuzzy scoring ───────
// Separate from IGNORE_WORDS — these filter the NAME side, not the query side.
const FORM_WORDS = new Set([
  "tablet","tablets","tab","tabs","capsule","capsules","cap","caps",
  "syrup","syrups","syp","suspension","susp","injection","injections","inj",
  "drops","drop","ointment","cream","gel","lotion","inhaler","inhalers",
  "spray","sprays","powder","powders","solution","solutions",
  "infusion","infusions","vaccine","vaccines",
  "kit","forte","plus","ds","xr","er","sr","od","bd","tds","qid",
]);

// Dosage pattern: pure numbers, or numbers with units like mg/mcg/ml/g/%/iu
const DOSAGE_RE = /^\d+(\.\d+)?(mg|mcg|ml|g|%|iu|units?|mm)?$/;

// Filler words to strip when building the clean medicine query: stop words, action verbs,
// generic terms — but NOT form words (tablet/syrup/ds…), which are part of the medicine name.
const FILLER_WORDS = new Set([...IGNORE_WORDS].filter(w => !FORM_WORDS.has(w)));

// Reduce arbitrary user text to just the medicine-identifying tokens (name + dose + form),
// dropping verbs/articles. This is the single string we score each candidate against.
function buildCleanQuery(text) {
  const normalized = text
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");
  const words = normalized.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.filter(w => !FILLER_WORDS.has(w)).join(" ");
}

function extractBaseName(medicineName) {
  const tokens = medicineName.toLowerCase().trim().split(/\s+/);
  const base = tokens.filter(t => !FORM_WORDS.has(t) && !DOSAGE_RE.test(t));
  return base.length ? base.join(" ") : medicineName.toLowerCase();
}

function shouldIgnoreNgram(ngram) {
  const words = ngram.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Ignore ngrams that carry no identifying medicine name — i.e. every token is a stop word,
  // a bare number/dosage, or a form word. "ds", "syrup", "ds syrup", "200mg" can't identify a
  // medicine on their own, and matching them retrieves noise like "DSP Tablet" / "Dsc Injection".
  return words.every(w => IGNORE_WORDS.has(w) || FORM_WORDS.has(w) || DOSAGE_RE.test(w));
}

// ── Indexes ───────────────────────────────────────────────────────────────────
let medicineIndex;                          // FlexSearch — primary, fast, prefix-exact
let trigramIndex = new Map();               // char trigram → medicineId[] — fallback, high-recall
let idToMedicineMap = new Map();
let loadedMedicines = [];                   // for ingredient search

// Minimum similarity for a candidate to be considered a plausible match at all. Deliberately
// low: this rejects garbage, it does NOT decide confidence. The auto-select/ambiguous decision
// is made later from the relative scores, so siblings must stay visible here.
const RELEVANCE_FLOOR = 0.5;

// ── Character trigrams ────────────────────────────────────────────────────────
function charTrigrams(str) {
  const s = str.toLowerCase().trim();
  const tgs = new Set();
  for (let i = 0; i <= s.length - 3; i++) tgs.add(s.slice(i, i + 3));
  return tgs;
}

// Returns up to `limit` medicine IDs sorted by trigram overlap with `query`.
// Only activates when FlexSearch returns nothing — not on the hot path.
function trigramLookup(query, limit = 20) {
  const qTgs = charTrigrams(query);
  if (qTgs.size === 0) return [];
  const overlap = new Map();
  for (const tg of qTgs) {
    const ids = trigramIndex.get(tg);
    if (!ids) continue;
    for (const id of ids) overlap.set(id, (overlap.get(id) || 0) + 1);
  }
  return Array.from(overlap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

// ── Similarity scoring ────────────────────────────────────────────────────────
// Token categories carry different weight so that ranking priority is:
//   medicine name (highest) > dosage/strength > form (lowest)
// Every category still contributes — none is discarded.
const TOKEN_WEIGHT = { base: 1.0, dose: 0.5, form: 0.25 };

function categorize(token) {
  if (DOSAGE_RE.test(token)) return "dose";
  if (FORM_WORDS.has(token)) return "form";
  return "base";
}

// Numeric part of a dose token: "200mg" → "200", "200" → "200".
function doseNum(token) {
  const m = token.match(/^\d+(\.\d+)?/);
  return m ? m[0] : token;
}

// Graded match quality between two tokens, in [0,1]:
//   - exact → 1 (an exact match always beats a fuzzy neighbour)
//   - dose  → 1 if same numeric value ("200" === "200mg"), else 0
//   - else  → 1 - editDistance/length when within a typo threshold, else 0
function tokenScore(a, ca, b, cb) {
  if (a === b) return 1;
  if (ca === "dose" || cb === "dose") return doseNum(a) === doseNum(b) ? 1 : 0;
  const maxLen = Math.max(a.length, b.length);
  const d = levenshtein.get(a, b);
  const thr = Math.max(1, Math.floor(maxLen * 0.3));
  return d <= thr ? 1 - d / maxLen : 0;
}

// Weighted directional coverage: for each token in `from`, find its best (graded) partner in
// `to`, consuming each partner once. Returns matched-weight / total-weight.
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

// Weighted bidirectional similarity between a clean query and a candidate name.
//   precision = how much of the query is explained by the name (dominates)
//   recall    = how much of the name is covered by the query (tie-breaker, favours tight names)
// Graded matching means the exact full name wins decisively over fuzzy neighbours, while
// dose/form weights keep ranking priority: name > dosage > form.
function getSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;

  const qRaw = s1.split(/\s+/).filter(Boolean);
  const nRaw = s2.split(/\s+/).filter(Boolean);
  if (!qRaw.length || !nRaw.length) return 0;

  const q = qRaw.map(t => { const c = categorize(t); return { t, c, w: TOKEN_WEIGHT[c] }; });
  const n = nRaw.map(t => { const c = categorize(t); return { t, c, w: TOKEN_WEIGHT[c] }; });

  const precision = directionalCoverage(q, n);
  const recall = directionalCoverage(n, q);
  return precision * 0.7 + recall * 0.3;
}

// ── Service init ──────────────────────────────────────────────────────────────
function initMedicineService() {
  return new Promise((resolve, reject) => {
    medicineIndex = new Document({
      document: { id: "id", index: ["name"] },
      tokenize: "forward",
    });

    const csvPath = path.join(__dirname, "..", "data", "medicines.csv");

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        if (row.id && row.name) {
          const medId = parseInt(row.id, 10);

          // FlexSearch (primary)
          medicineIndex.add({ id: medId, name: row.name });
          idToMedicineMap.set(medId, row.name);

          // Trigram index (fallback) — index on base name for better signal
          const base = extractBaseName(row.name);
          for (const tg of charTrigrams(base)) {
            if (!trigramIndex.has(tg)) trigramIndex.set(tg, []);
            trigramIndex.get(tg).push(medId);
          }

          // Ingredient cache
          loadedMedicines.push({ id: medId, name: row.name, salt_composition: row.salt_composition || "" });
        }
      })
      .on("end", () => {
        console.log(`Medicine extraction service initialized (${idToMedicineMap.size} medicines, ${trigramIndex.size} trigrams)`);
        resolve();
      })
      .on("error", reject);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildNgrams(text) {
  const normalized = text
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");
  const words = normalized.trim().split(/\s+/).filter(Boolean);
  const ngrams = new Set();
  for (let i = 0; i < words.length; i++) {
    ngrams.add(words[i]);
    if (i < words.length - 1) ngrams.add(`${words[i]} ${words[i+1]}`);
    if (i < words.length - 2) ngrams.add(`${words[i]} ${words[i+1]} ${words[i+2]}`);
    if (i < words.length - 3) ngrams.add(`${words[i]} ${words[i+1]} ${words[i+2]} ${words[i+3]}`);
  }
  return ngrams;
}

// Retrieval only — register a candidate id→name. Scoring happens later, ONCE, against the
// full clean query (not per-ngram), so a bare brand fragment can't flood every variant.
function registerCandidate(ngram, id, candidateMap) {
  const name = idToMedicineMap.get(id);
  if (!name) return;
  if (!candidateMap.has(id)) candidateMap.set(id, { id, name, matched_text: ngram });
}

// ── FlexSearch pass over all ngrams ──────────────────────────────────────────
function flexSearchPass(ngrams, candidateMap) {
  for (const ngram of ngrams) {
    if (shouldIgnoreNgram(ngram)) continue;
    const results = medicineIndex.search(ngram, 10);
    if (results && results[0]?.result?.length) {
      for (const id of results[0].result) registerCandidate(ngram, id, candidateMap);
    }
  }
}

// ── Trigram fallback pass ─────────────────────────────────────────────────────
function trigramPass(ngrams, candidateMap) {
  for (const ngram of ngrams) {
    if (shouldIgnoreNgram(ngram)) continue;
    const ids = trigramLookup(ngram, 20);
    for (const id of ids) registerCandidate(ngram, id, candidateMap);
  }
}

// ── Main extraction ───────────────────────────────────────────────────────────
async function extractMedicines(userText) {
  const ngrams = buildNgrams(userText);
  const candidateMap = new Map();

  // Primary: FlexSearch (fast, prefix-exact)
  flexSearchPass(ngrams, candidateMap);

  // Fallback: trigram index (high-recall, only when FlexSearch found nothing)
  if (candidateMap.size === 0) {
    console.log("[MedicineExtraction] FlexSearch miss — trying trigram fallback");
    trigramPass(ngrams, candidateMap);
    if (candidateMap.size > 0) {
      console.log(`[MedicineExtraction] Trigram fallback found ${candidateMap.size} candidate(s)`);
    }
  }

  // Score every retrieved candidate ONCE against the full clean query. Keep everything above a
  // low relevance floor (not a high cut) so sibling variants stay visible to the decision below —
  // a high cut can hide near-ties and create false confidence.
  const cleanQuery = buildCleanQuery(userText);
  let candidates = Array.from(candidateMap.values())
    .map(c => ({ ...c, similarity: getSimilarity(cleanQuery, c.name) }))
    .filter(c => c.similarity >= RELEVANCE_FLOOR);

  // Ingredient search — last resort when both indexes return nothing
  if (candidates.length === 0 && loadedMedicines.length > 0) {
    console.log("[MedicineExtraction] No name matches found, searching by ingredients...");
    const ingredientMatches = new Map();
    for (const ngram of ngrams) {
      if (shouldIgnoreNgram(ngram)) continue;
      for (const med of loadedMedicines) {
        if (med.salt_composition.toLowerCase().includes(ngram.toLowerCase())) {
          const similarity = getSimilarity(ngram, med.name);
          if (!ingredientMatches.has(med.id) || similarity > ingredientMatches.get(med.id).similarity) {
            ingredientMatches.set(med.id, { id: med.id, name: med.name, matched_text: ngram, similarity });
          }
        }
      }
    }
    candidates = Array.from(ingredientMatches.values()).sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    console.log(`[MedicineExtraction] Found ${candidates.length} medicines by ingredient match`);
  }

  const top5 = [...candidates].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  console.log(`\n========================================`);
  console.log(`[Top 5 Candidate Matches]`);
  top5.forEach((c, i) => console.log(`${i+1}. ${c.name} (matched: "${c.matched_text}", score: ${c.similarity.toFixed(3)})`));
  console.log(`========================================\n`);

  if (candidates.length === 0) return { status: "success", medicines: [] };

  const topCandidate = top5[0];
  const secondCandidate = top5[1];
  const topScore = topCandidate.similarity;
  const secondScore = secondCandidate ? secondCandidate.similarity : 0;
  const scoreDiff = topScore - secondScore;

  // Auto-select when there is an unambiguous winner:
  //   - EXACT: top is a (near-)perfect match (≥ 0.95). The user typed the full specific name,
  //     so a close second is just a more-specific variant — don't pester them.
  //   - CLEAR GAP: top is a solid match (≥ 0.7) AND clearly ahead of the runner-up (≥ 0.12).
  // Otherwise the candidates are too close (e.g. brand variants differing only in dose/form the
  // user didn't specify) → ask for clarification.
  const isExact = topScore >= 0.95;
  const isClearGap = topScore >= 0.7 && scoreDiff >= 0.12;
  if (isExact || isClearGap) {
    console.log(`[MedicineExtraction] Confident (score: ${topScore.toFixed(3)}, diff: ${scoreDiff.toFixed(3)}, via: ${isExact ? "exact" : "gap"})`);
    return {
      status: "success",
      medicines: [{ id: topCandidate.id || 0, name: topCandidate.name, matched_text: topCandidate.matched_text }]
    };
  }

  if (candidates.length > 1) {
    console.log("[MedicineExtraction] Multiple similar candidates — returning ambiguous");
    return {
      status: "ambiguous",
      clarification_question: "Did you mean one of these?",
      candidates: top5.map(c => ({ id: c.id, name: c.name }))
    };
  }

  // Single candidate — let LLM confirm
  const llmPrompt = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `User Text: "${userText}"\n\nCandidate Matches (JSON):\n${JSON.stringify(candidates, null, 2)}\n\nPlease extract the medicines or return a clarification question.` }
  ];
  try {
    const responseText = await chatCompletionJson(llmPrompt);
    const resultJson = JSON.parse(cleanLlmJsonResponse(responseText));
    if (resultJson.status === "ambiguous") {
      resultJson.candidates = top5.map(c => ({ id: c.id, name: c.name }));
    }
    return resultJson;
  } catch (error) {
    console.error("Error calling LLM for medicine extraction:", error);
    return { status: "success", medicines: [] };
  }
}

// ── Shared auto-select vs ambiguous decision ──────────────────────────────────
// Same rule used by extractMedicines: a (near-)exact top match, or a solid top with a clear gap
// over the runner-up, is confident; otherwise the candidates are too close → ambiguous. Expects
// `scored` already sorted by descending similarity, each { id, name, similarity }.
function decideSlot(scored) {
  const top = scored[0];
  const topScore = top.similarity;
  const secondScore = scored[1] ? scored[1].similarity : 0;
  const diff = topScore - secondScore;
  const isExact = topScore >= 0.95;
  const isClearGap = topScore >= 0.7 && diff >= 0.12;
  if (isExact || isClearGap || scored.length === 1) {
    return { status: "confident", medicine: { id: top.id, name: top.name } };
  }
  return { status: "ambiguous", options: scored.slice(0, 5).map(c => ({ id: c.id, name: c.name })) };
}

// ── Compare-pair resolver (compare intent) ────────────────────────────────────
// Fully deterministic + grounded. (1) Retrieve a dataset candidate pool from the message.
// (2) Segment the message into ≤2 medicine mentions by covering the cleaned query with the
//     highest-similarity, non-overlapping token spans — the dataset decides where the boundaries
//     are (handles "Crocin Advance" as one mention, any connector, no regex, no LLM).
// (3) Score the pool against each mention span and apply the deterministic decideSlot rule.
// Returns { slots: [{ status: "confident", medicine, query } | { status: "ambiguous", options, query }] }
// with length 0, 1, or 2.
async function resolveComparePair(message) {
  // 1. Ground — retrieve the candidate pool from our dataset. Run BOTH passes: compare needs up to
  // two medicines, and one may be found by FlexSearch while the other only surfaces via trigram
  // (e.g. "codex and hisplon" — codex hits FlexSearch, hisplon needs trigram). A global "FlexSearch
  // miss" check would drop the second medicine, so we always add trigram recall too. Span scoring +
  // the relevance floor filter out the extra trigram noise.
  const ngrams = buildNgrams(message);
  const candidateMap = new Map();
  flexSearchPass(ngrams, candidateMap);
  trigramPass(ngrams, candidateMap);
  const pool = Array.from(candidateMap.values()); // [{ id, name, matched_text }]
  if (pool.length === 0) {
    console.log("[CompareResolve] No grounded candidates — returning 0 slots");
    return { slots: [] };
  }

  // 2. Segment — cover the cleaned query with the best-scoring, non-overlapping spans.
  const cleanTokens = buildCleanQuery(message).split(/\s+/).filter(Boolean);
  if (cleanTokens.length === 0) {
    console.log("[CompareResolve] Query reduced to filler only — returning 0 slots");
    return { slots: [] };
  }

  // Score the pool once per candidate span, keeping each span's best candidate similarity.
  const spans = [];
  for (let i = 0; i < cleanTokens.length; i++) {
    for (let len = 1; len <= Math.min(4, cleanTokens.length - i); len++) {
      const text = cleanTokens.slice(i, i + len).join(" ");
      if (shouldIgnoreNgram(text)) continue; // skip bare dose/form spans ("650", "tablet")
      let best = 0;
      for (const c of pool) {
        const s = getSimilarity(text, c.name);
        if (s > best) best = s;
      }
      if (best >= RELEVANCE_FLOOR) spans.push({ start: i, end: i + len, text, score: best });
    }
  }

  // Greedily claim the highest-scoring spans without overlapping tokens (max 2 mentions).
  spans.sort((a, b) => b.score - a.score);
  const claimed = new Array(cleanTokens.length).fill(false);
  const mentions = [];
  for (const sp of spans) {
    if (mentions.length >= 2) break;
    let overlap = false;
    for (let k = sp.start; k < sp.end; k++) if (claimed[k]) { overlap = true; break; }
    if (overlap) continue;
    for (let k = sp.start; k < sp.end; k++) claimed[k] = true;
    mentions.push(sp);
  }
  mentions.sort((a, b) => a.start - b.start); // left-to-right reading order

  console.log(`[CompareResolve] segmented ${mentions.length} mention(s): ${mentions.map(m => `"${m.text}"`).join(", ") || "none"}`);

  // 3. Decide per slot — score the pool against the mention span, then apply decideSlot.
  const slots = [];
  for (const m of mentions) {
    const scored = pool
      .map(c => ({ id: c.id, name: c.name, similarity: getSimilarity(m.text, c.name) }))
      .filter(c => c.similarity >= RELEVANCE_FLOOR)
      .sort((a, b) => b.similarity - a.similarity);
    if (scored.length === 0) continue;
    const decision = decideSlot(scored);
    console.log(`[CompareResolve] slot "${m.text}" → ${decision.status}${decision.medicine ? ` (${decision.medicine.name})` : ` (${decision.options.length} options)`}`);
    slots.push({ ...decision, query: m.text, topName: scored[0].name });
  }
  if (slots.length === 0) return { slots: [] };

  // 4. Validate — let the LLM reject spans that are conversational words coincidentally matching a
  // medicine ("lets compare…" → "Lets 2.5mg Tablet"). Grounded: it only judges spans already tied to
  // real rows, never invents medicines. On any failure we keep the deterministic slots.
  return { slots: await validateMentions(message, slots) };
}

// LLM false-positive filter for resolved compare spans. Returns the kept slots (topName stripped).
// Verdicts are mapped back by INDEX (primary) with a phrase fallback — the LLM sometimes echoes the
// matched medicine name instead of the asked phrase (e.g. answers "hisplon" for the span "meant"),
// so a phrase-only lookup would silently default-keep the false positive.
async function validateMentions(message, slots) {
  const strip = arr => arr.map(({ topName, ...rest }) => rest);
  const llmPrompt = [
    { role: "system", content: COMPARE_VALIDATE_SYSTEM_PROMPT },
    { role: "user", content: `User message: "${message}"\n\nDetected mentions:\n${slots.map((s, i) => `${i + 1}. phrase: "${s.query}" → matched medicine: "${s.topName}"`).join("\n")}\n\nReturn a verdict for every numbered mention, echoing its index.` }
  ];
  try {
    // SMART tier: this is a grammatical-role judgment call ("meant"/verb vs "codex"/name) with a
    // documented history of subtle mistakes on smaller models — worth the rate-limit cost, and it
    // only runs once per compare-from-scratch resolution, not on every message.
    const responseText = await chatCompletionJsonSmart(llmPrompt);
    const result = JSON.parse(cleanLlmJsonResponse(responseText));
    const arr = Array.isArray(result.results) ? result.results : [];
    const byIndex = new Map();
    const byPhrase = new Map();
    for (const r of arr) {
      const ok = r.is_medicine !== false;
      if (r.index != null) byIndex.set(Number(r.index), ok);
      if (r.phrase != null) byPhrase.set(String(r.phrase).toLowerCase(), ok);
    }
    const keep = (s, i) => {
      if (byIndex.has(i + 1)) return byIndex.get(i + 1);
      if (byPhrase.has(s.query.toLowerCase())) return byPhrase.get(s.query.toLowerCase());
      return true; // no verdict for this slot → default keep
    };
    const kept = slots.filter((s, i) => keep(s, i));
    const dropped = slots.filter(s => !kept.includes(s));
    if (dropped.length) console.log(`[CompareResolve] LLM rejected false positives: ${dropped.map(s => `"${s.query}"`).join(", ")}`);
    return strip(kept);
  } catch (err) {
    console.error("[CompareResolve] validation LLM error — keeping deterministic slots:", err.message);
    return strip(slots);
  }
}

// ── Image (OCR) medicine resolver ─────────────────────────────────────────────
// Grounds the structured medicines Gemini read off a label/prescription against our dataset.
// Each detected name (+ its dosage, which helps pick the right variant) is retrieved and scored
// with the SAME machinery as typed text, then run through decideSlot. No LLM validation needed —
// these came from the vision model's structured extraction, not free conversational text.
// Returns { grounded: [{id,name}], ambiguous: [{query, options}], unresolved: [name,...] }.
async function resolveImageMedicines(ocrMedicines) {
  const grounded = [];
  const ambiguous = [];
  const unresolved = [];

  for (const item of (ocrMedicines || [])) {
    const rawName = (item?.name || "").trim();
    if (!rawName) continue;

    const query = [rawName, item?.dosage].filter(Boolean).join(" ");
    const ngrams = buildNgrams(query);
    const candidateMap = new Map();
    flexSearchPass(ngrams, candidateMap);
    trigramPass(ngrams, candidateMap);
    const pool = Array.from(candidateMap.values());
    if (pool.length === 0) { unresolved.push(rawName); continue; }

    const cleanQuery = buildCleanQuery(query);
    const scored = pool
      .map(c => ({ id: c.id, name: c.name, similarity: getSimilarity(cleanQuery, c.name) }))
      .filter(c => c.similarity >= RELEVANCE_FLOOR)
      .sort((a, b) => b.similarity - a.similarity);
    if (scored.length === 0) { unresolved.push(rawName); continue; }

    const decision = decideSlot(scored);
    if (decision.status === "confident") grounded.push(decision.medicine);
    else ambiguous.push({ query: rawName, options: decision.options });
  }

  console.log(`[ImageResolve] grounded=[${grounded.map(m => m.name).join(", ") || "none"}] ambiguous=[${ambiguous.map(a => a.query).join(", ") || "none"}] unresolved=[${unresolved.join(", ") || "none"}]`);
  return { grounded, ambiguous, unresolved };
}

module.exports = { initMedicineService, extractMedicines, resolveComparePair, resolveImageMedicines, getSimilarity };
