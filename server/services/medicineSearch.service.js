// server/services/medicineSearch.js
const fs = require("fs");
const csv = require("csv-parser");
const levenshtein = require("fast-levenshtein");
const { classLabel, atcOfficialName, describeAtc } = require("./atcExplain.service");

let medicines = [];
let ingredientIndex = new Map(); // ingredient → Set of medicine indices
let atcIndex4 = new Map(); // 4-char ATC prefix → Set of medicine indices
let atcIndex5 = new Map(); // 5-char ATC code → Set of medicine indices
let allMedicinesByName = new Map(); // lowercase name → full record, NO filtering — used by searchMedicineByName
let loaded = false;

// Common ingredient descriptions
const INGREDIENT_DESCRIPTIONS = {
  "vitamin b12": "Supports nerve function and red blood cell formation",
};

const EXCLUDE_FORMS = [
  "accuhaler", "addshe-kit", "adsorbed", "androgel", "divicap", "dol-kit", "dologel", "douche", "dpicaps",
  "dr", "er", "evohaler", "inhalation", "inhaler", "injection", "innospray", "instacap", "instacaps", "ir",
  "kit", "kwikpen", "multihaler", "novocart", "octacap", "octacaps", "oestrogel", "oxipule", "pen", "penfill",
  "pulmicaps", "rapitab", "readymix", "redicaps", "redimed", "redimix", "respicap", "respicaps", "respule",
  "respules", "rheocap", "rotacap", "rotacaps", "solostar", "spray", "spray/drop", "spray/solution",
  "starhaler", "suppositories", "suppository", "suppressant", "syringe", "tears", "transcaps", "transgel",
  "transhaler", "transpules", "turbuhaler", "ultigel", "vaccine", "vomispray", "wash", "xr", "infusion", "shot",
  "ampoule", "iv", "im"
];

// Load the normalization map and ingredient codes
const ingredientNormalization = JSON.parse(
  fs.readFileSync("data/ingredientNormalization.json", "utf8")
);

const rawIngredientCodes = JSON.parse(
  fs.readFileSync("data/ingredientCodes.json", "utf8")
);

// Normalize an ingredient using the ingredientNormalization map
function normalizeIngredient(raw) {
  const cleaned = raw.toLowerCase().trim();

  // Use the normalization map (which already handles PIN mapping)
  const normalized = ingredientNormalization[cleaned] || cleaned;

  // ✅ FIX 1: Force lowercase for consistency
  return normalized.toLowerCase();
}

// Build ingredient codes lookup with normalized keys
const ingredientCodes = {};
for (const key in rawIngredientCodes) {
  const data = rawIngredientCodes[key];

  // For combinations, we don't normalize the key (keep as-is)
  // For single ingredients, use the baseIngredient as the key
  if (data.isCombination) {
    ingredientCodes[key.toLowerCase()] = data;
  } else {
    const normalizedKey = (data.baseIngredient || key).toLowerCase();
    ingredientCodes[normalizedKey] = data;
  }
}

function isExcludedForm(name) {
  const n = name.toLowerCase();
  return EXCLUDE_FORMS.some(f => n.includes(f));
}

// Normalize a parenthesized strength for comparison: "(650 mg)" → "650mg". Irregular strengths
// ("0.1% w/w", "5mg/ml") become opaque lowercase strings — equal strings still compare equal.
function normalizeDose(raw) {
  const d = String(raw || "").toLowerCase().replace(/\s+/g, "");
  return d || null;
}

// Extract normalized ingredients AND their strengths from a salt composition.
// Returns { ingredients: [...], doseMap: { ingredient → dose|null } }. Combination-expanded
// components get dose null (the salt string carries no per-component strength for them).
function extractIngredientsWithDose(saltComposition) {
  const doseMap = {};
  if (!saltComposition) return { ingredients: [], doseMap };

  // Split by + or comma
  const parts = saltComposition.split(/[+,]/).map(s => s.trim()).filter(Boolean);

  const normalizedParts = [];

  for (const part of parts) {
    const doseMatch = part.match(/\(([^)]*)\)/);
    const dose = doseMatch ? normalizeDose(doseMatch[1]) : null;

    // Remove dosage information (anything in parentheses)
    const withoutDosage = part.replace(/\s*\([^)]*\)/g, '').trim();

    const normalized = normalizeIngredient(withoutDosage);

    // Check if this ingredient itself is a combination in our codes
    const data = ingredientCodes[normalized];

    if (data?.isCombination && data.components?.length > 0) {
      // It's a combination - expand it to individual components
      for (const component of data.components) {
        let ing = null;
        if (component.pin) {
          ing = component.pin.toLowerCase();
        } else if (component.cleaned) {
          ing = normalizeIngredient(component.cleaned);
        }
        if (ing) {
          normalizedParts.push(ing);
          if (!(ing in doseMap)) doseMap[ing] = null;
        }
      }
    } else {
      // It's a single ingredient
      normalizedParts.push(normalized);
      if (!(normalized in doseMap)) doseMap[normalized] = dose;
    }
  }

  return { ingredients: [...new Set(normalizedParts)], doseMap };
}

// Extract and normalize ingredients from salt composition
function extractIngredients(saltComposition) {
  return extractIngredientsWithDose(saltComposition).ingredients;
}

// Per-unit price from the pack label ("strip of 15 tablets" → price/15). Null when unparseable.
function unitPriceOf(price, packSize) {
  const m = String(packSize || "").match(/(\d+(?:\.\d+)?)\s*(tablets?|capsules?|ml|gm|g\b|sachets?|drops?)/i);
  if (!m) return null;
  const count = parseFloat(m[1]);
  if (!count || !(price > 0)) return null;
  return { unit_price: price / count, unit: m[2].toLowerCase().replace(/s$/, "") };
}

// Get ATC domains for a list of ingredients
function getDomainsForIngredients(ingredients) {
  const domains = new Set();

  for (const ing of ingredients) {
    // ✅ FIX 2: ingredients are already normalized, don't normalize again
    const data = ingredientCodes[ing];

    // Check if it's a combination
    if (data?.isCombination && data.components?.length > 0) {
      // Get ATC codes from all components
      for (const component of data.components) {
        if (component.atc) {
          component.atc.forEach(code => domains.add(code));
        }
      }
    } else if (data?.atc) {
      // Single ingredient
      data.atc.forEach(code => domains.add(code));
    }
  }

  return [...domains];
}

// --------------------------
// Load CSV with logs
// --------------------------
async function loadMedicines() {
  return new Promise((resolve, reject) => {
    if (loaded) return resolve();

    const results = [];

    fs.createReadStream("data/medicines.csv")
      .pipe(csv())
      // Replace the .on("data") section with this heavily instrumented version:

      .on("data", (row) => {
        const record = {
          name: row.name,
          price: Number(row.price) || 0,
          type: row.type || "",
          comp1: row.short_composition1 || "",
          comp2: row.short_composition2 || "",
          salt_composition: row.salt_composition || "",
          manufacturer: row.manufacturer_name || "",
          pack_size: row.pack_size_label || "",
          medicine_desc: row.medicine_desc || "",
          side_effects: row.side_effects || "",
          drug_interactions: row.drug_interactions || ""
        };

        // All records go into the name map (no filtering) — used by searchMedicineByName
        allMedicinesByName.set(row.name.toLowerCase(), record);

        // Filtered array (for similarity search only). Discontinued products stay searchable by
        // name (explain still works) but must never be suggested as substitutes.
        if (isExcludedForm(row.name)) return;
        if (String(row.Is_discontinued).trim().toUpperCase() === "TRUE") return;
        const { ingredients, doseMap } = extractIngredientsWithDose(row.salt_composition);
        if (ingredients.length === 0) return;

        const medIndex = results.length;
        const domains = getDomainsForIngredients(ingredients);
        // Precomputed once: the medicine's own primary 3-char class, used to reject candidates
        // whose match to a query comes from a side membership (esomeprazole carries M01AE via
        // "naproxen and esomeprazole" combination products — its primary class is A02).
        const primaryAtc3 = describeAtc(domains)?.atc3 || null;

        results.push({ ...record, ingredients, doseMap, domains, primaryAtc3 });

        ingredients.forEach(ing => {
          if (!ingredientIndex.has(ing)) ingredientIndex.set(ing, new Set());
          ingredientIndex.get(ing).add(medIndex);
        });

        domains.forEach(code => {
          const c = String(code).toUpperCase();
          const p4 = c.slice(0, 4);
          if (!atcIndex5.has(c)) atcIndex5.set(c, new Set());
          atcIndex5.get(c).add(medIndex);
          if (!atcIndex4.has(p4)) atcIndex4.set(p4, new Set());
          atcIndex4.get(p4).add(medIndex);
        });
      })
      .on("end", () => {
        medicines = results;
        loaded = true;
        console.log(`\n✅ Total medicines loaded: ${medicines.length} (filtered), ${allMedicinesByName.size} (full lookup)`);
        console.log(`📊 Unique ingredients indexed: ${ingredientIndex.size}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Error loading CSV:", err);
        reject(err);
      });
  });
}

function findSimilar(queryIngredients, queryDoseMap = {}) {
  if (!loaded) return [];

  const normalizedQuery = queryIngredients.map(normalizeIngredient);

  const baseDomains = getDomainsForIngredients(normalizedQuery);

  // Find medicines that contain ALL query ingredients (intersection)
  let candidateIndices = null;

  for (const ing of normalizedQuery) {
    const medicinesWithThisIngredient = ingredientIndex.get(ing) || new Set();

    if (candidateIndices === null) {
      // First ingredient - start with all medicines that have it
      candidateIndices = new Set(medicinesWithThisIngredient);
    } else {
      // Subsequent ingredients - keep only medicines that ALSO have this ingredient (intersection)
      candidateIndices = new Set(
        [...candidateIndices].filter(idx => medicinesWithThisIngredient.has(idx))
      );
    }
  }

  if (!candidateIndices || candidateIndices.size === 0) {
    return [];
  }

  const results = [];

  for (const idx of candidateIndices) {
    const med = medicines[idx];

    // At this point, we KNOW the medicine has all query ingredients
    const queryIngredientsInMed = normalizedQuery.filter(i =>
      med.ingredients.includes(i)
    ).length;

    const medIngredientsInQuery = med.ingredients.filter(i =>
      normalizedQuery.includes(i)
    ).length;

    // This will always be 1.0 now, since all query ingredients are in the medicine
    const ingredientOverlap = 1.0;

    // Strength comparison: only flag a difference when BOTH sides carry a parsed dose for the
    // ingredient — one-sided nulls are missing data, not a known mismatch.
    const doseDiffs = [];
    for (const ing of normalizedQuery) {
      const qDose = queryDoseMap[ing] || null;
      const mDose = (med.doseMap || {})[ing] || null;
      if (qDose && mDose && qDose !== mDose) {
        doseDiffs.push({ ingredient: ing, target: qDose, candidate: mDose });
      }
    }

    let substitutionType = "UNSAFE";

    if (
      med.ingredients.length === normalizedQuery.length &&
      queryIngredientsInMed === normalizedQuery.length &&
      medIngredientsInQuery === med.ingredients.length
    ) {
      // Same ingredients, same count — EXACT only when the strengths also match.
      substitutionType = doseDiffs.length ? "SAME_SALT_DIFF_STRENGTH" : "EXACT";
    } else if (
      queryIngredientsInMed === normalizedQuery.length &&
      med.ingredients.length > normalizedQuery.length
    ) {
      // Medicine has extra ingredients beyond the query
      substitutionType = "COMBINATION";
    } else if (
      baseDomains.length > 0 &&
      med.domains.some(d => baseDomains.includes(d))
    ) {
      substitutionType = "THERAPEUTIC";
    } else if (ingredientOverlap > 0) {
      substitutionType = "PARTIAL";
    }

    const extraIngredients = med.ingredients.filter(
      ing => !normalizedQuery.includes(ing)
    );

    // Scoring: Now we penalize ONLY for extra ingredients
    const ingredientScore = 1.0; // Always 1.0 since all query ingredients are present

    const extraIngredientPenalty =
      extraIngredients.length === 0
        ? 1.0  // Perfect - no extra ingredients
        : Math.max(
          0.5,  // Minimum score of 0.5 even with extra ingredients
          1 - (extraIngredients.length * 0.1)  // Penalize 10% per extra ingredient
        );

    const sharedDomains = med.domains.filter(d =>
      baseDomains.includes(d)
    );

    const domainScore =
      baseDomains.length === 0
        ? 0.5
        : sharedDomains.length / baseDomains.length;

    let confidence =
      ingredientScore * 0.4 +        // Has all ingredients
      domainScore * 0.35 +           // Therapeutic domain match
      extraIngredientPenalty * 0.25; // Penalty for extra ingredients

    confidence = confidence.toFixed(2);

    const extraEffects = {};
    extraIngredients.forEach(ing => {
      if (INGREDIENT_DESCRIPTIONS[ing]) {
        extraEffects[ing] = INGREDIENT_DESCRIPTIONS[ing];
      } else {
        const data = ingredientCodes[ing];
        const label = data?.atc?.length ? classLabel(data.atc) : null;
        extraEffects[ing] = label
          ? `Therapeutic class: ${label}`
          : (data?.atc?.length ? `Therapeutic class: ${data.atc.join(", ")}` : "Additional active ingredient");
      }
    });

    const unit = unitPriceOf(med.price, med.pack_size);

    results.push({
      name: med.name,
      price: med.price,
      unit_price: unit ? unit.unit_price : null,
      unit: unit ? unit.unit : null,

      comp1: med.comp1,
      comp2: med.comp2,
      salt_composition: med.salt_composition,

      substitutionType,
      confidence,
      doseDiffs,

      ingredientCount: med.ingredients.length,
      ingredients: med.ingredients,
      doseMap: med.doseMap,
      domain: med.domains.join(",") || "UNKNOWN",

      extraIngredients,
      extraEffects,
      atc_codes: med.domains,

      manufacturer: med.manufacturer,
      pack_size: med.pack_size,

      medicine_desc: med.medicine_desc,
      side_effects: med.side_effects,
      drug_interactions: med.drug_interactions
    });
  }

  return dedupeAndSort(results);
}

const TYPE_RANK = { EXACT: 0, SAME_SALT_DIFF_STRENGTH: 1, COMBINATION: 2, THERAPEUTIC: 3, PARTIAL: 4, UNSAFE: 5 };

// Same-strength exacts first, then same-salt-different-strength, then combinations; within a
// group cheapest per unit first (per-pack price when the pack label is unparseable).
function compareResults(a, b) {
  const rankDiff = (TYPE_RANK[a.substitutionType] ?? 9) - (TYPE_RANK[b.substitutionType] ?? 9);
  if (rankDiff !== 0) return rankDiff;
  if (a.unit_price != null && b.unit_price != null && a.unit_price !== b.unit_price) return a.unit_price - b.unit_price;
  if (a.unit_price != null && b.unit_price == null) return -1;
  if (a.unit_price == null && b.unit_price != null) return 1;
  return a.price - b.price;
}

// Collapse the same product in different pack sizes (same name), then cap one listing per
// (manufacturer + salt-with-strength) so the top results aren't near-identical brand variants.
function dedupeAndSort(results) {
  const sorted = results.sort(compareResults);

  const byName = new Map();
  for (const r of sorted) {
    const key = r.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, r); // sorted → first seen is the best-priced pack
  }

  const seenVariant = new Set();
  const out = [];
  for (const r of byName.values()) {
    const doseSig = (r.ingredients || []).map(ing => `${ing}:${(r.doseMap || {})[ing] || ""}`).sort().join("+");
    const variantKey = `${(r.manufacturer || "").toLowerCase()}::${doseSig}`;
    if (seenVariant.has(variantKey)) continue;
    seenVariant.add(variantKey);
    out.push(r);
  }
  return out;
}

// --------------------------
// Exported function for route
// --------------------------
// queryText is a salt composition, ideally WITH strengths ("Paracetamol (650mg)") so results can
// be ranked strength-aware; parens are parsed here, so callers no longer need to strip them.
async function getSimilarMedicines(queryText) {
  await loadMedicines();
  const { ingredients, doseMap } = extractIngredientsWithDose(queryText);
  return findSimilar(ingredients, doseMap);
}

// Dosage-form token from a product name ("Brufen 400 Tablet" → "tablet") for like-for-like
// therapeutic suggestions. Null when the name carries no recognizable form.
function formToken(name) {
  const m = String(name || "").match(/\b(tablet|capsule|syrup|suspension|expectorant|drops?|gel|cream|ointment|lotion|spray|solution|injection|powder|sachet|suppositor(?:y|ies))\b/i);
  return m ? m[1].toLowerCase().replace(/s$/, "") : null;
}

// Same-class-but-different-salt candidates for a set of query ingredients — the fallback when no
// same-salt substitute exists. Matches on the 5-char ATC code first (closest chemical subgroup),
// then the 4-char prefix; candidates sharing ANY query ingredient are excluded (those belong to
// findSimilar). One result per distinct salt set, cheapest first.
//
// Guards against the promiscuous class memberships RxNorm assigns ingredients:
//  - query codes whose WHO class name says "combination" are dropped (e.g. N02AJ "Opioids in
//    combination with non-opioid analgesics" would suggest codeine syrups for paracetamol);
//  - matching is restricted to the query's PRIMARY 3-char class (ibuprofen also carries R02AX
//    throat-lozenge and M02AA topical memberships that would drag in oral rinses and gels);
//  - candidates must have the same number of active ingredients as the query;
//  - candidates must share the target's dosage form when both are known (no syrups for tablets).
function findTherapeuticAlternatives(queryIngredients, { limit = 5, targetName = null } = {}) {
  if (!loaded) return [];

  const normalizedQuery = queryIngredients.map(normalizeIngredient);
  const querySet = new Set(normalizedQuery);
  let queryCodes = getDomainsForIngredients(normalizedQuery)
    .map(c => String(c).toUpperCase())
    .filter(c => !/combination/i.test(atcOfficialName(c) || ""));
  const primary = describeAtc(queryCodes);
  if (primary) queryCodes = queryCodes.filter(c => c.startsWith(primary.atc3));
  if (queryCodes.length === 0) return [];

  const targetForm = formToken(targetName);

  // index → { matchedCode, matchLevel } — atc5 hits win over atc4-only hits
  const candidates = new Map();
  for (const code of queryCodes) {
    for (const idx of atcIndex5.get(code) || []) {
      candidates.set(idx, { matchedCode: code, matchLevel: "atc5" });
    }
  }
  for (const code of queryCodes) {
    const p4 = code.slice(0, 4);
    for (const idx of atcIndex4.get(p4) || []) {
      if (!candidates.has(idx)) candidates.set(idx, { matchedCode: code, matchLevel: "atc4" });
    }
  }

  const results = [];
  for (const [idx, match] of candidates) {
    const med = medicines[idx];
    if (med.ingredients.some(ing => querySet.has(ing))) continue;
    if (med.ingredients.length !== normalizedQuery.length) continue;
    if (primary && med.primaryAtc3 && med.primaryAtc3 !== primary.atc3) continue;
    const candidateForm = formToken(med.name);
    if (targetForm && candidateForm && candidateForm !== targetForm) continue;

    const unit = unitPriceOf(med.price, med.pack_size);
    results.push({
      name: med.name,
      price: med.price,
      unit_price: unit ? unit.unit_price : null,
      unit: unit ? unit.unit : null,
      manufacturer: med.manufacturer,
      pack_size: med.pack_size,
      salt_composition: med.salt_composition,
      ingredients: med.ingredients,
      atc_codes: med.domains,
      matchedCode: match.matchedCode,
      matchLevel: match.matchLevel,
      // atc4 matches share only the 4-char subgroup — label with that broader class, not the
      // query's exact 5-char class (gabapentin isn't a "fever reducer" just because it's N02B).
      className: classLabel([match.matchLevel === "atc5" ? match.matchedCode : match.matchedCode.slice(0, 4)])
    });
  }

  // atc5 (same chemical subgroup) before atc4, then cheapest per unit.
  results.sort((a, b) => {
    if (a.matchLevel !== b.matchLevel) return a.matchLevel === "atc5" ? -1 : 1;
    if (a.unit_price != null && b.unit_price != null && a.unit_price !== b.unit_price) return a.unit_price - b.unit_price;
    if (a.unit_price != null && b.unit_price == null) return -1;
    if (a.unit_price == null && b.unit_price != null) return 1;
    return a.price - b.price;
  });

  // One result per distinct salt set — otherwise the list is N brands of the same alternative.
  const seenSalt = new Set();
  const out = [];
  for (const r of results) {
    const sig = [...r.ingredients].sort().join("+");
    if (seenSalt.has(sig)) continue;
    seenSalt.add(sig);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function searchMedicineByName(medicineName) {
  if (!loaded || !medicineName) return null;
  const lowerQuery = medicineName.toLowerCase().trim();

  // Exact name match first (fastest, no filtering)
  if (allMedicinesByName.has(lowerQuery)) return allMedicinesByName.get(lowerQuery);

  // Substring scan against all medicines (unfiltered)
  for (const [key, rec] of allMedicinesByName) {
    if (key.includes(lowerQuery)) return rec;
  }

  // Ingredient fallback (filtered array only — needs parsed ingredients)
  const byIngredient = medicines.find(m => m.ingredients.some(ing => ing.includes(lowerQuery)));
  return byIngredient || null;
}

module.exports = {
  getSimilarMedicines,
  findTherapeuticAlternatives,
  loadMedicines,
  normalizeIngredient,
  extractIngredients,
  extractIngredientsWithDose,
  unitPriceOf,
  getDomainsForIngredients,
  searchMedicineByName
};