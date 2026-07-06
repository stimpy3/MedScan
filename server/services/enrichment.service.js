// server/services/enrichment.service.js
// Grounded, India-first enrichment for missing medicine data. Resolves a dataset name to its Tata
// 1mg drug page via the offline sitemap index (token-aware match, precision-first guards), fetches
// the page, and extracts fields DETERMINISTICALLY from the embedded `window.__INITIAL_STATE__` JSON
// (1mg's own structured data — no LLM, no tokens). Every result carries its 1mg source + match score.
const axios = require("axios");
const { matchOneMg, normKey } = require("./oneMgMatch.service");
const { getSimilarity } = require("./medicineExtraction.service");

// Rotate among real browser User-Agents so requests don't all look identical.
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
];
const randomUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

// Accept thresholds (precision-first: better to leave a row empty than fill it from the wrong drug).
const ACCEPT_SCORE = 0.85;  // index-match similarity floor
const VERIFY_SCORE = 0.80;  // post-fetch name re-check floor

const FORMS = new Set(["tablet", "tablets", "capsule", "capsules", "syrup", "suspension", "injection", "cream", "gel", "drops", "ointment", "lotion", "powder", "spray", "respules", "rotacaps", "sachet", "solution", "inhaler"]);
function formsOf(normName) {
  return new Set(String(normName).split(" ").filter(t => FORMS.has(t)));
}
// A dosage FORM conflict (e.g. our "...tablet" matched a 1mg "...syrup") → different product, reject.
function formConflict(aNorm, bNorm) {
  const a = formsOf(aNorm), b = formsOf(bNorm);
  if (!a.size || !b.size) return false;
  for (const f of a) if (b.has(f)) return false; // share a form → ok
  return true; // both have forms, none shared
}

// ── Discovery: dataset name → 1mg drug URL, with precision guards ─────────────────────────────
// Returns { url, key, score } or { reject:<reason>, score, key }.
function resolveDrug(name) {
  const m = matchOneMg(name);
  if (!m) return { reject: "no_candidate" };
  const q = normKey(name);
  if (m.score < ACCEPT_SCORE) return { reject: "low_score", score: m.score, key: m.key };
  if (formConflict(q, m.key)) return { reject: "form_conflict", score: m.score, key: m.key };
  return { url: m.url, key: m.key, score: m.score };
}

// ── Page parse: pull 1mg's embedded INITIAL_STATE JSON and read structured fields ────────────
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
function clean(html) {
  if (!html) return null;
  const out = String(html)
    .replace(/<\/(li|p|div|tr|h[1-6])>/gi, "; ")
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ").replace(/(;\s*)+/g, "; ").replace(/^;\s*|;\s*$/g, "").trim();
  return out || null;
}
function factAttrs(node) {
  const out = {};
  for (const a of (node?.attributesData || [])) out[a.label] = clean(a.value);
  return out;
}

// 1mg's Safety Advice section: per-category verdicts (SAFE / UNSAFE / CAUTION / SAFE IF PRESCRIBED /
// CONSULT YOUR DOCTOR) with a one-line explanation. Deterministic 1mg facts — the backbone of the
// personalized safety layer (pregnancy/alcohol/kidney/liver checks never need an LLM to *find* these).
const SAFETY_ADVICE_KEYS = {
  "alcohol": "alcohol",
  "pregnancy": "pregnancy",
  "breast feeding": "breastfeeding",
  "breastfeeding": "breastfeeding",
  "driving": "driving",
  "kidney": "kidney",
  "liver": "liver"
};
function parseSafetyAdvice(sd) {
  const list = sd?.safetyAdvice?.warnings;
  if (!Array.isArray(list) || !list.length) return null;
  const out = {};
  for (const w of list) {
    const key = SAFETY_ADVICE_KEYS[String(w.displayText || w.imageAltText || "").toLowerCase().trim()];
    if (!key) continue;
    const verdict = clean(w.label || w.tag?.label);
    const text = clean(w.description);
    if (verdict || text) out[key] = { verdict: verdict || null, text: text || null };
  }
  return Object.keys(out).length ? out : null;
}

// 1mg's "Interaction with drugs" section: named drugs with severity + effect. Capped — popular
// medicines list hundreds; 150 keeps the cache record bounded while covering the real list for most.
function parseDrugInteractions(sd) {
  const rows = sd?.interactionWithDrugs?.attributesData;
  if (!Array.isArray(rows) || !rows.length) return null;
  const out = [];
  for (const r of rows.slice(0, 150)) {
    const drug = r.gaLabel?.salt_name || clean(r.header);
    if (!drug) continue;
    out.push({ drug: String(drug).trim(), severity: r.severity || null, effect: clean(r.actionExperience) });
  }
  return out.length ? out : null;
}
function parseDrugPage(html, sourceUrl) {
  const state = extractInitialState(html);
  const sd = state?.drugPageReducer?.staticData;
  if (!sd) return null;
  const fb = factAttrs(sd.factBoxData);
  let sideEffects = clean(sd.sideEffect?.content);
  if (sideEffects) {
    const m = sideEffects.match(/common side effects[^:;]*[:;]?\s*/i);
    if (m) sideEffects = sideEffects.slice(m.index + m[0].length).trim() || sideEffects;
  }
  return {
    matchedName: sd.sku?.name || sd.productConfig?.entity_name || null,
    salt_composition: clean(sd.sku?.summary?.salt_composition?.display_text),
    medicine_desc: clean(sd.productIntroduction?.content),
    uses: clean(sd.productUses?.content),
    side_effects: sideEffects,
    safety_advice: parseSafetyAdvice(sd),
    drug_interactions: parseDrugInteractions(sd),
    how_works: clean(sd.howWorks?.content),
    manufacturer: sd.manufacturerInfo?.name || null,
    therapeutic_class: fb["Therapeutic Class"] || null,
    chemical_class: fb["Chemical Class"] || null,
    action_class: fb["Action Class"] || null,
    source: sourceUrl
  };
}

async function fetchDrugPage(url) {
  const resp = await axios.get(url, {
    headers: {
      "User-Agent": randomUA(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.1mg.com/",
      "Upgrade-Insecure-Requests": "1"
    },
    timeout: 20000,
    validateStatus: () => true
  });
  if (resp.status !== 200) return { ok: false, status: resp.status };
  return { ok: true, html: String(resp.data) };
}

// Main entry: name → grounded fields (or { found:false, reason }).
async function enrichMedicineFromWeb(name) {
  const r = resolveDrug(name);
  if (r.reject) return { name, found: false, reason: r.reject, score: r.score ?? null, candidate: r.key ?? null };

  const page = await fetchDrugPage(r.url);
  if (!page.ok) return { name, found: false, reason: `fetch_http_${page.status}`, source: r.url };

  const parsed = parseDrugPage(page.html, r.url);
  if (!parsed) return { name, found: false, reason: "no_initial_state", source: r.url };

  // Final precision guard: the page's canonical name must still resemble what we asked for.
  const verify = getSimilarity(normKey(name), normKey(parsed.matchedName || ""));
  if (verify < VERIFY_SCORE) {
    return { name, found: false, reason: "name_verify_failed", score: r.score, verify: Number(verify.toFixed(3)), source: r.url, candidate: parsed.matchedName };
  }

  return { name, found: true, matchScore: r.score, ...parsed };
}

module.exports = { enrichMedicineFromWeb, resolveDrug, parseDrugPage, fetchDrugPage };
