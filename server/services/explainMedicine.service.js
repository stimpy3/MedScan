// server/services/explainMedicine.service.js
const { EXPLAIN_MEDICINE_SYSTEM_PROMPT } = require("../prompts/explainMedicine.prompt");
const { ANSWER_FIELD_SYSTEM_PROMPT } = require("../prompts/answerField.prompt");
const { chatCompletionJson } = require("./groq.service");
const { searchMedicineByName, extractIngredients, getDomainsForIngredients, findTherapeuticAlternatives } = require("./medicineSearch.service");
const { describeAtc } = require("./atcExplain.service");
const { lazyEnrichFields } = require("./lazyEnrichment.service");
const { runSafetyCheck } = require("./safetyCheck.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

// Passed to the writer for fields that stay empty even after the lazy web check — the prompt
// instructs it to say so plainly instead of inventing.
const NOT_FOUND_TEXT = "No verified information found (database and 1mg were checked).";
const ENRICHABLE = ["salt_composition", "medicine_desc", "side_effects"];

// Shared data assembly for the full card AND targeted sub-field answers:
// CSV lookup → databaseDetails skeleton → lazy web enrichment of empty fields → NOT_FOUND fill.
// includeSafety additionally requests safety_advice + drug_interactions (only asked for when the
// caller actually has a health profile to check against — see getMedicineExplanationCard).
async function assembleMedicineDetails(medicineName, includeSafety = false) {
  const med = searchMedicineByName(medicineName);

  let databaseDetails = {};
  let price = 0;
  let pack_size = "";
  let manufacturer = "";

  if (med) {
    console.log(`[ExplainMedicineService] Found medicine in database:`, med.name);
    databaseDetails = {
      name: med.name,
      medicine_desc: med.medicine_desc || "",
      salt_composition: med.salt_composition || "",
      short_composition1: med.comp1 || "",
      short_composition2: med.comp2 || "",
      side_effects: med.side_effects || "",
      manufacturer_name: med.manufacturer || "",
      type: "Allopathy", // We can default or extract if defined
      pack_size_label: med.pack_size || "",
      price: med.price || 0,
      drug_interactions: med.drug_interactions || ""
    };
    price = med.price || 0;
    pack_size = med.pack_size || "";
    manufacturer = med.manufacturer || "";
  } else {
    console.log(`[ExplainMedicineService] Medicine "${medicineName}" not found in local database. Trying lazy web enrichment.`);
    databaseDetails = {
      name: medicineName,
      medicine_desc: "",
      salt_composition: "",
      short_composition1: "",
      short_composition2: "",
      side_effects: "",
      manufacturer_name: "Unknown",
      type: "Allopathy",
      pack_size_label: "Unknown",
      price: 0,
      drug_interactions: ""
    };
  }

  // Lazy enrichment: whatever the CSV is missing gets fetched on demand from verified 1mg data
  // (deterministic index/parse first, Serper fallback). Fills ONLY empty fields.
  let webSources = [];
  try {
    const web = await lazyEnrichFields(databaseDetails.name, databaseDetails, { includeSafety });
    if (web?.found) {
      for (const f of ENRICHABLE) {
        if (!String(databaseDetails[f] || "").trim() && web.fields[f]) databaseDetails[f] = web.fields[f];
      }
      if (!databaseDetails.safety_advice && web.fields.safety_advice) databaseDetails.safety_advice = web.fields.safety_advice;
      if (!(databaseDetails.drug_interactions || "").length && web.fields.drug_interactions) databaseDetails.drug_interactions = web.fields.drug_interactions;
      webSources = web.sources || [];
    }
  } catch (error) {
    console.error("[ExplainMedicineService] Lazy enrichment failed:", error.message);
  }

  // Whatever is STILL empty: tell the writer plainly — it must say "not found", never invent.
  for (const f of ENRICHABLE) {
    if (!String(databaseDetails[f] || "").trim()) databaseDetails[f] = NOT_FOUND_TEXT;
  }

  return { databaseDetails, price, pack_size, manufacturer, webSources };
}

// Runs the personalized safety check for one medicine's already-assembled data. Never throws;
// returns the "off" shape when there's no safetyContext, matching MedicineCard's expectations.
async function checkSafety(databaseDetails, safetyContext) {
  if (!safetyContext) return { checked: false, warnings: [], note: null };
  const safety = await runSafetyCheck({
    medicines: [{
      name: databaseDetails.name,
      composition: databaseDetails.salt_composition,
      description: databaseDetails.medicine_desc,
      side_effects: databaseDetails.side_effects,
      safety_advice: databaseDetails.safety_advice,
      drug_interactions: databaseDetails.drug_interactions
    }],
    safetyContext
  });
  const forMed = safety.results[0];
  return safety.checked
    ? { checked: true, warnings: forMed?.warnings || [], note: forMed?.personalNote || null }
    : { checked: false, warnings: [], note: null };
}

// Deterministic ATC-derived class info for the card: friendly class label, "commonly used for"
// bullets, and up to 3 same-class (different-salt) examples. Null when the salt is missing,
// is the NOT_FOUND sentinel, or maps to no ATC codes — the card renders without the section.
function buildTherapeuticClass(medicineName, saltComposition) {
  const salt = String(saltComposition || "").trim();
  if (!salt || salt === NOT_FOUND_TEXT) return null;

  const ingredients = extractIngredients(salt);
  const codes = getDomainsForIngredients(ingredients);
  const atc = describeAtc(codes);
  if (!atc) return null;

  const sameClassExamples = findTherapeuticAlternatives(ingredients, { limit: 3, targetName: medicineName })
    .map(m => ({ name: m.name, price: m.price > 0 ? `₹${m.price.toFixed(2)}` : null }));

  return {
    label: atc.friendlyLabel,
    officialName: atc.className,
    commonUses: atc.commonUses,
    sameClassExamples
  };
}

async function getMedicineExplanationCard(medicineName, safetyContext = null) {
  console.log(`[ExplainMedicineService] Explaining medicine: "${medicineName}"`);

  const { databaseDetails, price, pack_size, manufacturer, webSources } = await assembleMedicineDetails(medicineName, !!safetyContext);
  const therapeuticClass = buildTherapeuticClass(databaseDetails.name, databaseDetails.salt_composition);

  const messages = [
    { role: "system", content: EXPLAIN_MEDICINE_SYSTEM_PROMPT },
    { role: "user", content: `Please generate the structured explanation for this medicine:\n\n${JSON.stringify(databaseDetails, null, 2)}` }
  ];

  // Card writer (Groq) and personalized safety check (Cerebras) run in parallel — the safety
  // check never blocks or slows the card beyond its own bounded timeout.
  const [cardResult, safety] = await Promise.allSettled([
    chatCompletionJson(messages),
    checkSafety(databaseDetails, safetyContext)
  ]);
  const safetyValue = safety.status === "fulfilled" ? safety.value : { checked: false, warnings: [], note: null };

  if (cardResult.status === "fulfilled") {
    try {
      const cleanedText = cleanLlmJsonResponse(cardResult.value);
      const generatedDetails = JSON.parse(cleanedText);

      return {
        name: databaseDetails.name,
        type: databaseDetails.type || "Allopathy",
        category: generatedDetails.category || "Medication",
        short_desc: generatedDetails.short_desc || "",
        price: price > 0 ? `₹${price.toFixed(2)}` : "Price not available",
        pack_size: pack_size || "Standard Packaging",
        overview: generatedDetails.overview || "",
        composition: generatedDetails.composition || "",
        side_effects: generatedDetails.side_effects || "",
        manufacturer: generatedDetails.manufacturer || manufacturer || "Unknown Manufacturer",
        therapeuticClass,
        sources: webSources,
        safety: safetyValue
      };
    } catch (error) {
      console.error("[ExplainMedicineService] Error parsing LLM explanation:", error);
    }
  } else {
    console.error("[ExplainMedicineService] Error calling LLM for explanation:", cardResult.reason);
  }

  // Graceful fallback (LLM call failed or its response didn't parse) — safety still attaches.
  return {
    name: databaseDetails.name,
    type: "Allopathy",
    category: "Medication",
    short_desc: `Information details for ${databaseDetails.name}`,
    price: price > 0 ? `₹${price.toFixed(2)}` : "Price not available",
    pack_size: pack_size || "Standard Packaging",
    overview: databaseDetails.medicine_desc || "No overview available.",
    composition: databaseDetails.salt_composition || "No composition details available.",
    side_effects: databaseDetails.side_effects || "No side effects information available.",
    manufacturer: manufacturer || "Unknown Manufacturer",
    therapeuticClass,
    sources: webSources,
    safety: safetyValue
  };
}

// ── Targeted sub-field answers ────────────────────────────────────────────────────────────────
// "side effects of Dolo 650" → a short chat reply about ONLY that aspect, not the full card.
const FIELD_LABELS = {
  side_effects: "side effects",
  composition: "composition",
  uses: "uses",
  price: "price",
  manufacturer: "manufacturer",
  pack_size: "pack size"
};

async function answerMedicineField(medicineName, subField) {
  console.log(`[ExplainMedicineService] Targeted answer: "${medicineName}" → ${subField}`);

  const { databaseDetails, price, pack_size, manufacturer, webSources } = await assembleMedicineDetails(medicineName);
  const name = databaseDetails.name;
  const label = FIELD_LABELS[subField] || subField;
  const honestMiss = `I couldn't find a verified ${label} for ${name} in my database.`;

  // Deterministic fields — hard rule: the LLM never authors prices/numbers/names.
  if (subField === "price") {
    const reply = price > 0
      ? `${name} costs ₹${price.toFixed(2)}${pack_size && pack_size !== "Unknown" ? ` for ${pack_size.toLowerCase()}` : ""}.`
      : honestMiss;
    return { reply, sources: [] };
  }
  if (subField === "manufacturer") {
    const reply = manufacturer && manufacturer !== "Unknown"
      ? `${name} is manufactured by ${manufacturer}.`
      : honestMiss;
    return { reply, sources: [] };
  }
  if (subField === "pack_size") {
    const reply = pack_size && pack_size !== "Unknown"
      ? `${name} comes as ${pack_size.toLowerCase()}.`
      : honestMiss;
    return { reply, sources: [] };
  }

  // LLM-phrased fields, grounded ONLY on the assembled field text (CSV or lazily web-fetched).
  let sourceText;
  if (subField === "composition") {
    const parts = [databaseDetails.salt_composition, databaseDetails.short_composition1, databaseDetails.short_composition2]
      .filter(t => t && t !== NOT_FOUND_TEXT);
    sourceText = parts.join(" + ");
  } else if (subField === "uses") {
    sourceText = databaseDetails.medicine_desc !== NOT_FOUND_TEXT ? databaseDetails.medicine_desc : "";
  } else { // side_effects
    sourceText = databaseDetails.side_effects !== NOT_FOUND_TEXT ? databaseDetails.side_effects : "";
  }

  if (!String(sourceText || "").trim()) {
    // Nothing verified anywhere — say so plainly, never invent. LLM skipped entirely.
    return { reply: `I couldn't find verified ${label} information for ${name} — I checked our database and 1mg.`, sources: [] };
  }

  try {
    const responseText = await chatCompletionJson([
      { role: "system", content: ANSWER_FIELD_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ medicineName: name, aspect: label, sourceText }, null, 2) }
    ]);
    const parsed = JSON.parse(cleanLlmJsonResponse(responseText));
    const answer = String(parsed.answer || "").trim();
    if (answer) return { reply: answer, sources: webSources };
  } catch (error) {
    console.error("[ExplainMedicineService] Targeted answer LLM failed:", error.message);
  }
  // Fallback: the raw field text with a short lead-in — grounded by construction.
  return { reply: `Here's the ${label} information for ${name}: ${sourceText}`, sources: webSources };
}

module.exports = { getMedicineExplanationCard, answerMedicineField, assembleMedicineDetails };
