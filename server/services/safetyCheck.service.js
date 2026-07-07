// server/services/safetyCheck.service.js
// Personalized safety layer: checks medicines against the requesting user's health profile
// (allergies, conditions, pregnancy, alcohol) and their current medicines (schedules + manual).
//
// Two layers, cheapest first:
//   1. DETERMINISTIC — 1mg safety-advice verdicts (pregnancy/breastfeeding/alcohol/kidney/liver)
//      matched against profile flags, and 1mg/CSV drug-interaction lists matched against the
//      user's current medicines' salts. No LLM, no cost, no hallucination surface.
//   2. LLM (Cerebras GLM 4.7) — only the fuzzy remainder: allergies (drug-family matching) and
//      general conditions. Skipped entirely when the profile has neither.
//
// Guarantees: returns in ~0ms with { checked:false } when there is no usable profile; NEVER
// throws; the LLM call is timeout-bounded and its output is validated (unknown types dropped,
// types without a matching profile fact dropped, severity capped when composition unverified).
// Results are cached in-memory per (medicines + profileHash) — never persisted to disk, because
// cached values contain profile-derived text.
const { chatCompletionJson } = require("./cerebras.service");
const { SAFETY_CHECK_SYSTEM_PROMPT } = require("../prompts/safetyCheck.prompt");
const { searchMedicineByName, extractIngredients } = require("./medicineSearch.service");
const { runAtcRules } = require("./atcRules.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

// Matches explainMedicine.service's NOT_FOUND_TEXT fill (not imported — would create a require
// cycle once explainMedicine imports this service). Sentinel text must never reach the LLM as data.
const NOT_FOUND_PREFIX = "no verified information found";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // key → { at, value }

const MAX_WARNINGS_PER_MED = 5;
const MAX_MESSAGE_LEN = 220;

// ── small utils ───────────────────────────────────────────────────────────────────────────────
const lc = (s) => String(s || "").toLowerCase().trim();
const isSentinel = (s) => lc(s).startsWith(NOT_FOUND_PREFIX);
const textOf = (s) => (s && !isSentinel(s) ? String(s).trim() : "");
const truncate = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

function profileIsEmpty(profile, currentMedicines) {
  if (!profile) return true;
  const anyList = ["allergies", "conditions"].some(k => Array.isArray(profile[k]) && profile[k].length);
  const anyFlag = profile.pregnant || profile.breastfeeding ||
    ["occasional", "regular"].includes(lc(profile.alcohol));
  return !anyList && !anyFlag && !(currentMedicines || []).length;
}

function cacheKey(medicines, safetyContext) {
  const names = medicines.map(m => lc(m.name)).sort().join("|");
  return `${names}::${safetyContext.profileHash || "nohash"}`;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // drop oldest insertion
  cache.set(key, { at: Date.now(), value });
}

// ── deterministic layer: 1mg safety-advice verdicts vs profile flags ─────────────────────────
// SAFE / SAFE IF PRESCRIBED → no warning. UNSAFE → high. CAUTION / CONSULT → medium.
function verdictSeverity(verdict) {
  const v = String(verdict || "").toUpperCase();
  if (!v) return null;
  if (v.includes("UNSAFE")) return "high";
  if (v.includes("CAUTION") || v.includes("CONSULT")) return "medium";
  return null;
}

function adviceWarnings(med, profile) {
  const advice = med.safety_advice;
  if (!advice || typeof advice !== "object") return [];
  const conditions = (profile.conditions || []).map(lc);
  const hasCondition = (...terms) => conditions.some(c => terms.some(t => c.includes(t)));
  const out = [];

  const add = (type, entry, contextLabel) => {
    const severity = verdictSeverity(entry?.verdict);
    if (!severity) return;
    out.push({
      type,
      severity,
      message: truncate(entry.text || `1mg marks ${med.name} "${entry.verdict}" for ${contextLabel}.`, MAX_MESSAGE_LEN),
      basis: `profile: ${contextLabel} + 1mg safety advice verdict "${entry.verdict}"`
    });
  };

  if (profile.pregnant) add("pregnancy", advice.pregnancy, "pregnant");
  if (profile.breastfeeding) add("pregnancy", advice.breastfeeding, "breastfeeding");
  if (["occasional", "regular"].includes(lc(profile.alcohol))) add("alcohol", advice.alcohol, `alcohol use (${lc(profile.alcohol)})`);
  if (hasCondition("kidney", "renal")) add("condition", advice.kidney, "kidney condition");
  if (hasCondition("liver", "hepatic")) add("condition", advice.liver, "liver condition");
  return out;
}

// ── deterministic layer: drug-interaction lists vs the user's current medicines ──────────────
// Interaction data arrives in two shapes:
//   1mg parse:  [{ drug, severity, effect }]
//   CSV column: '{"drug":[...], "brand":[...], "effect":[...]}' (effect doubles as severity)
function normalizeInteractions(raw) {
  if (Array.isArray(raw)) {
    return raw.map(r => ({ drug: lc(r.drug), brands: [], severity: r.severity || r.effect || null, effect: r.effect || null }));
  }
  const text = textOf(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const drugs = parsed.drug || [];
    return drugs.map((d, i) => ({
      drug: lc(d),
      brands: String((parsed.brand || [])[i] || "").split(",").map(lc).filter(Boolean),
      severity: (parsed.effect || [])[i] || null,
      effect: (parsed.effect || [])[i] || null
    }));
  } catch { return []; }
}

function mapInteractionSeverity(s) {
  const t = lc(s);
  if (/life|severe|serious/.test(t)) return "high";
  if (/moderate/.test(t)) return "medium";
  if (/mild|minor/.test(t)) return "low";
  return "medium";
}

// Salts of a current medicine: CSV lookup → normalized ingredients; fallback to the name minus dosage.
function saltsOf(medicineName) {
  const rec = searchMedicineByName(medicineName);
  const salts = rec ? extractIngredients(rec.salt_composition || "") : [];
  if (salts.length) return salts;
  const bare = lc(medicineName).replace(/\s*\d+(\.\d+)?\s*(mg|mcg|g|ml|iu)\b.*$/i, "").trim();
  return bare ? [bare] : [];
}

const nameMatch = (a, b) => a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a));

function interactionWarnings(med, currentMedicines, targetSalts) {
  const entries = normalizeInteractions(med.drug_interactions);
  if (!entries.length || !currentMedicines.length) return [];
  const out = [];
  const seen = new Set();

  for (const current of currentMedicines) {
    // Don't warn a medicine against itself (it's usually in the user's own schedule).
    const currentSalts = saltsOf(current);
    if (targetSalts.length && currentSalts.some(s => targetSalts.includes(s))) continue;

    for (const entry of entries) {
      const hit =
        currentSalts.some(s => nameMatch(s, entry.drug)) ||
        entry.brands.some(b => nameMatch(lc(current), b)) ||
        nameMatch(lc(current), entry.drug);
      if (!hit) continue;
      const dedupe = `${entry.drug}::${lc(current)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const effectText = entry.effect && !/^(life|severe|moderate|mild)/i.test(entry.effect)
        ? ` ${entry.effect}`
        : "";
      out.push({
        type: "interaction",
        severity: mapInteractionSeverity(entry.severity),
        message: truncate(`${med.name} can interact with ${current} (${entry.drug}).${effectText} Ask a doctor before combining.`, MAX_MESSAGE_LEN),
        basis: `current medicine "${current}" (salt: ${entry.drug}) + listed interaction severity "${entry.severity}"`
      });
    }
  }
  return out;
}

// ── LLM layer: allergies + general conditions only ────────────────────────────────────────────
const LLM_ALLOWED_TYPES = new Set(["allergy", "condition", "age"]);

function validateLlmWarnings(warnings, profile, compositionVerified) {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter(w => w && LLM_ALLOWED_TYPES.has(w.type) && ["high", "medium", "low"].includes(w.severity))
    .filter(w => {
      if (w.type === "allergy") return (profile.allergies || []).length > 0;
      if (w.type === "condition") return (profile.conditions || []).length > 0;
      if (w.type === "age") return profile.ageYears != null;
      return false;
    })
    .map(w => ({
      type: w.type,
      // A "high" allergy call needs a verified composition to be grounded on.
      severity: !compositionVerified && w.severity === "high" ? "medium" : w.severity,
      message: truncate(String(w.message || ""), MAX_MESSAGE_LEN),
      basis: truncate(String(w.basis || ""), MAX_MESSAGE_LEN)
    }))
    .filter(w => w.message);
}

async function runLlmLayer(medicines, profile, currentMedicines, timeoutMs) {
  const payload = {
    medicines: medicines.map(m => ({
      name: m.name,
      composition: textOf(m.composition),
      description: textOf(m.description),
      side_effects: textOf(m.side_effects)
    })),
    profile: {
      ageYears: profile.ageYears ?? null,
      gender: profile.gender || null,
      allergies: profile.allergies || [],
      conditions: profile.conditions || []
    },
    currentMedicines
  };

  const llmCall = chatCompletionJson([
    { role: "system", content: SAFETY_CHECK_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload, null, 2) }
  ], { timeoutMs });

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("safety LLM timeout")), timeoutMs));
  const responseText = await Promise.race([llmCall, timeout]);
  const parsed = JSON.parse(cleanLlmJsonResponse(responseText));
  return Array.isArray(parsed.results) ? parsed.results : [];
}

// ── main entry ────────────────────────────────────────────────────────────────────────────────
// medicines: [{ name, composition, description, side_effects, safety_advice?, drug_interactions? }]
// safetyContext: { profile: {...}, currentMedicines: [names], profileHash }
// → { checked, results: [{ name, warnings: [{type, severity, message, basis}], personalNote }] }
async function runSafetyCheck({ medicines, safetyContext, timeoutMs = 8000 }) {
  try {
    if (!Array.isArray(medicines) || !medicines.length || !safetyContext?.profile) {
      return { checked: false, results: [] };
    }
    const profile = safetyContext.profile;
    const currentMedicines = (safetyContext.currentMedicines || []).filter(Boolean);
    if (profileIsEmpty(profile, currentMedicines)) return { checked: false, results: [] };

    const key = cacheKey(medicines, safetyContext);
    const hit = cacheGet(key);
    if (hit) {
      console.log("[SafetyCheck] cache hit");
      return hit;
    }

    // Layer 1 — deterministic (always runs, costs nothing): 1mg verdicts + interaction lists,
    // plus structured ATC class rules (NSAID×kidney, duplicate therapy, CNS×alcohol, ...).
    const atc = runAtcRules({ medicines, profile, currentMedicines });
    const results = medicines.map((med, i) => {
      const targetSalts = extractIngredients(textOf(med.composition));
      return {
        name: med.name,
        warnings: [
          ...adviceWarnings(med, profile),
          ...interactionWarnings(med, currentMedicines, targetSalts),
          ...(atc.results[i]?.warnings || [])
        ],
        personalNote: null
      };
    });

    // Layer 2 — LLM, only when the fuzzy fields exist to check.
    const needsLlm = (profile.allergies || []).length > 0 || (profile.conditions || []).length > 0;
    let llmFailed = false;
    if (needsLlm) {
      try {
        const llmResults = await runLlmLayer(medicines, profile, currentMedicines, timeoutMs);
        for (let i = 0; i < results.length; i++) {
          const forMed = llmResults.find(r => lc(r.medicine) === lc(results[i].name)) || llmResults[i];
          if (!forMed) continue;
          const compositionVerified = !!textOf(medicines[i].composition);
          // Kidney/liver conditions are already covered deterministically — drop LLM duplicates.
          // Same for any condition an ATC rule already fired on (its terms regexes are collected).
          const dupCondition = new Set(results[i].warnings.filter(w => w.type === "condition").map(w => w.basis));
          const validated = validateLlmWarnings(forMed.warnings, profile, compositionVerified)
            .filter(w => !(w.type === "condition" && /kidney|renal|liver|hepatic/i.test(w.basis) && dupCondition.size))
            .filter(w => !(w.type === "condition" && atc.firedConditionRegexes.some(rx => rx.test(w.basis) || rx.test(w.message))));
          results[i].warnings.push(...validated);
          const note = String(forMed.personalNote || "").trim();
          if (note) results[i].personalNote = truncate(note, 300);
        }
      } catch (e) {
        llmFailed = true;
        console.error("[SafetyCheck] LLM layer failed (deterministic results kept):", e.message);
      }
    }

    for (const r of results) {
      r.warnings = r.warnings.slice(0, MAX_WARNINGS_PER_MED);
    }

    // If the profile demanded LLM judgment (allergies/conditions) but the LLM failed AND the
    // deterministic layer found nothing, we can't honestly claim "checked, no concerns".
    const anyWarnings = results.some(r => r.warnings.length);
    if (llmFailed && !anyWarnings) return { checked: false, results: [] };

    const value = { checked: true, results };
    cacheSet(key, value);
    return value;
  } catch (e) {
    console.error("[SafetyCheck] failed hard (returning unchecked):", e.message);
    return { checked: false, results: [] };
  }
}

module.exports = { runSafetyCheck };
