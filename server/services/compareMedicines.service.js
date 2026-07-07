// server/services/compareMedicines.service.js
const { COMPARE_MEDICINES_SYSTEM_PROMPT } = require("../prompts/compareMedicines.prompt");
const { chatCompletionJsonSmart } = require("./groq.service");
const { searchMedicineByName, extractIngredients, getDomainsForIngredients } = require("./medicineSearch.service");
const { classLabel } = require("./atcExplain.service");
const { lazyEnrichFields } = require("./lazyEnrichment.service");
const { runSafetyCheck } = require("./safetyCheck.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

function titleCase(str) {
  return String(str || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Build the deterministic, database-backed half of a medicine column.
function buildColumn(key, requestedName) {
  const med = searchMedicineByName(requestedName);
  if (med) {
    // searchMedicineByName returns the raw name-map record, which has NO ingredients/domains —
    // recompute them from salt_composition so the "what they share" decision is actually grounded.
    const ingredients = extractIngredients(med.salt_composition || "");
    return {
      key,
      found: true,
      name: med.name,
      type: titleCase(med.type) || "Allopathy",
      priceValue: med.price || 0,
      pack_size: med.pack_size || "Standard pack",
      manufacturer: med.manufacturer || "Unknown manufacturer",
      salt_composition: med.salt_composition || "",
      medicine_desc: med.medicine_desc || "",
      side_effects: med.side_effects || "",
      drug_interactions: med.drug_interactions || "",
      ingredients,
      domains: getDomainsForIngredients(ingredients)
    };
  }
  return {
    key,
    found: false,
    name: requestedName,
    type: "Allopathy",
    priceValue: 0,
    pack_size: "Unknown",
    manufacturer: "Unknown manufacturer",
    salt_composition: "",
    medicine_desc: "",
    side_effects: "",
    drug_interactions: "",
    ingredients: [],
    domains: []
  };
}

// Lazily fill a column's missing fields from verified 1mg data (fills ONLY empty fields).
// If the composition got filled, recompute ingredients/domains so the "what they share"
// grounding benefits from the web data too. includeSafety additionally requests the
// structured safety fields (only when the requester has a health profile to check against).
async function enrichColumnFromWeb(col, includeSafety = false) {
  try {
    const web = await lazyEnrichFields(col.name, col, { includeSafety });
    if (web?.found) {
      let saltFilled = false;
      for (const f of ["salt_composition", "medicine_desc", "side_effects"]) {
        if (!String(col[f] || "").trim() && web.fields[f]) {
          col[f] = web.fields[f];
          if (f === "salt_composition") saltFilled = true;
        }
      }
      if (!col.safety_advice && web.fields.safety_advice) col.safety_advice = web.fields.safety_advice;
      if (!(col.drug_interactions || "").length && web.fields.drug_interactions) col.drug_interactions = web.fields.drug_interactions;
      if (saltFilled) {
        col.ingredients = extractIngredients(col.salt_composition);
        col.domains = getDomainsForIngredients(col.ingredients);
      }
      col.sources = web.sources || [];
    }
  } catch (error) {
    console.error(`[CompareMedicinesService] Lazy enrichment failed for "${col.name}":`, error.message);
  }
  return col;
}

function formatPrice(value) {
  return value > 0 ? `₹${value.toFixed(2)}` : "N/A";
}

// Compact, database-only fallback used when the LLM call fails.
function fallbackQualitative(a, b) {
  const firstSentence = (text, fallback) => {
    if (!text) return fallback;
    const s = String(text).split(/(?<=[.!?])\s/)[0].trim();
    return s.length > 90 ? `${s.slice(0, 87)}...` : s;
  };
  const trimEffects = (text) => {
    if (!text) return "Not available";
    return text.split(",").slice(0, 3).map(s => s.trim()).filter(Boolean).join(", ");
  };
  return {
    useA: firstSentence(a.medicine_desc, "Use information not available"),
    useB: firstSentence(b.medicine_desc, "Use information not available"),
    compositionA: a.salt_composition || "Not available",
    compositionB: b.salt_composition || "Not available",
    sideEffectsA: trimEffects(a.side_effects),
    sideEffectsB: trimEffects(b.side_effects),
    similarities: [],
    verdict: "Both are treatment options — consult a doctor or pharmacist before switching."
  };
}

async function getComparison(nameA, nameB, safetyContext = null) {
  console.log(`[CompareMedicinesService] Comparing "${nameA}" vs "${nameB}"`);

  const a = buildColumn("A", nameA);
  const b = buildColumn("B", nameB);

  // On-demand web fill for whatever the CSV is missing, both columns in parallel.
  const includeSafety = !!safetyContext;
  await Promise.all([enrichColumnFromWeb(a, includeSafety), enrichColumnFromWeb(b, includeSafety)]);

  // Personalized safety check — BOTH medicines in one Cerebras call, kicked off here so it
  // overlaps with the Groq comparison call below. Resolves to the "off" shape without a profile.
  const safetyPromise = includeSafety
    ? runSafetyCheck({
        medicines: [a, b].map(col => ({
          name: col.name,
          composition: col.salt_composition,
          description: col.medicine_desc,
          side_effects: col.side_effects,
          safety_advice: col.safety_advice,
          drug_interactions: col.drug_interactions
        })),
        safetyContext
      }).catch(() => ({ checked: false, results: [] }))
    : Promise.resolve({ checked: false, results: [] });

  // Deterministic shared signals (the trustworthy grounding for "similarities"). Same use case ⇔
  // they share an active ingredient OR an ATC therapeutic class (compared at level 2 — the first 3
  // chars, e.g. "J01" antibacterials vs "R05" cough/cold — so unrelated drugs are never grouped).
  const sharedIngredients = a.ingredients.filter(ing => b.ingredients.includes(ing));
  const atcClass = code => String(code || "").slice(0, 3);
  const aClasses = new Set(a.domains.map(atcClass).filter(Boolean));
  const sharedClassCodes = b.domains.filter(d => aClasses.has(atcClass(d)));
  const sharesTherapeuticClass = sharedClassCodes.length > 0;
  const sameForm = !!a.type && a.type === b.type;
  // Drives whether the card shows "What They Share" at all. Only true when there is real grounded
  // overlap — never on the LLM's say-so, so we don't claim e.g. an antibiotic and a cough syrup
  // are alike just because both can involve the respiratory system.
  const sharesUseCase = sharedIngredients.length > 0 || sharesTherapeuticClass;

  const llmInput = {
    medicineA: {
      name: a.name,
      composition: a.salt_composition,
      description: a.medicine_desc,
      side_effects: a.side_effects
    },
    medicineB: {
      name: b.name,
      composition: b.salt_composition,
      description: b.medicine_desc,
      side_effects: b.side_effects
    },
    sharedSignals: {
      sharedActiveIngredients: sharedIngredients.map(titleCase),
      sharesTherapeuticClass,
      sameDosageType: sameForm ? a.type : null
    }
  };

  let qualitative;
  try {
    const messages = [
      { role: "system", content: COMPARE_MEDICINES_SYSTEM_PROMPT },
      { role: "user", content: `Compare these two medicines and return the JSON:\n\n${JSON.stringify(llmInput, null, 2)}` }
    ];
    // SMART tier: this synthesizes the use/composition/side-effects summaries and the verdict —
    // has a documented history of fabricating shared similarities beyond the grounded signals
    // (see [[compare-medicines-feature]]). Safety-relevant (medical comparison) and only runs
    // once per compare request, so the rate-limit cost is worth it.
    const responseText = await chatCompletionJsonSmart(messages);
    qualitative = JSON.parse(cleanLlmJsonResponse(responseText));
  } catch (error) {
    console.error("[CompareMedicinesService] LLM error, using fallback:", error.message);
    qualitative = fallbackQualitative(a, b);
  }

  // Determine cheaper side + savings, deterministically.
  let cheaper = null;
  let priceDeltaPct = null;
  if (a.priceValue > 0 && b.priceValue > 0 && a.priceValue !== b.priceValue) {
    const cheaperCol = a.priceValue < b.priceValue ? a : b;
    const pricierCol = a.priceValue < b.priceValue ? b : a;
    cheaper = cheaperCol.key;
    priceDeltaPct = Math.round(((pricierCol.priceValue - cheaperCol.priceValue) / pricierCol.priceValue) * 100);
  }

  // Assemble aligned difference rows. Only include rows that have content.
  const differences = [
    { label: "Primary Use", a: qualitative.useA, b: qualitative.useB },
    { label: "Composition", a: qualitative.compositionA || a.salt_composition, b: qualitative.compositionB || b.salt_composition },
    { label: "Side Effects", a: qualitative.sideEffectsA, b: qualitative.sideEffectsB },
    { label: "Manufacturer", a: a.manufacturer, b: b.manufacturer },
    { label: "Pack Size", a: a.pack_size, b: b.pack_size }
  ].filter(row => row.a || row.b);

  // Similarities: shown ONLY when the medicines genuinely share a use case, and built purely from
  // grounded signals (never the LLM's free text, which fabricated false overlaps like "both treat
  // respiratory problems"). When the uses differ this stays empty, the card hides "What They Share",
  // and the difference rows + verdict carry the "these are different" story.
  const similarities = [];
  if (sharesUseCase) {
    if (sharedIngredients.length) similarities.push(`Both contain ${sharedIngredients.map(titleCase).join(", ")}`);
    if (sharesTherapeuticClass) {
      const label = classLabel(sharedClassCodes);
      similarities.push(label ? `Belong to the same therapeutic class (${label})` : "Belong to the same therapeutic class");
    }
    if (sameForm) similarities.push(`Both are ${a.type.toLowerCase()} medicines`);
  }

  const verdict = sharesUseCase
    ? (qualitative.verdict || "Both are treatment options — consult a doctor or pharmacist before switching.")
    : "These are used for different conditions and aren't interchangeable — check with a doctor or pharmacist.";

  // Safety results arrive per input medicine in the same order they were passed ([a, b]).
  const safetyRaw = await safetyPromise;
  const perMedicine = safetyRaw.checked
    ? [a, b].map((col, i) => ({
        name: col.name,
        warnings: safetyRaw.results[i]?.warnings || [],
        note: safetyRaw.results[i]?.personalNote || null
      }))
    : [];

  return {
    medicines: [
      { key: "A", name: a.name, type: a.type, price: formatPrice(a.priceValue), manufacturer: a.manufacturer },
      { key: "B", name: b.name, type: b.type, price: formatPrice(b.priceValue), manufacturer: b.manufacturer }
    ],
    cheaper,
    priceDeltaPct,
    differences,
    similarities,
    sharesUseCase,
    verdict,
    safety: { checked: safetyRaw.checked, perMedicine },
    sources: [...new Set([...(a.sources || []), ...(b.sources || [])])]
  };
}

module.exports = { getComparison };
